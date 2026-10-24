import { EvidenceMappingLink } from "@/components/integrations/EvidenceMappingLink";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { admin, enabled } from "@/lib/integrations/wix-orders/server";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";
import { DateRangeFields, SavedHistoryFilter } from "@/components/integrations/DateRangeFields";
import { resolveImportRange, resolveViewRange } from "@/lib/integrations/date-range";

export const dynamic = "force-dynamic";

type HistoryReport = {
  totals: { currency_code: string; order_count: number; total_amount: number; paid_count: number }[];
  coverage: { start_date: string; end_date: string; imported_through: string; complete: boolean }[];
  covered_days: number; complete_days: number; requested_days: number | null;
};

export default async function WixOrdersPage({ searchParams }: { searchParams?: Promise<{ result?: string; from?: string; to?: string }> }) {
  const access = await requireWorkspacePage();
  const owner = access.context.membership?.role === "owner";
  const available = enabled();
  const params = await searchParams;
  const result = params?.result;
  const now = new Date(), today = now.toISOString().slice(0, 10);
  const defaultRange = resolveImportRange(null, null, now);
  let view = { startDate: null, endDate: null } as ReturnType<typeof resolveViewRange>;
  let invalidFilter = false;
  try { view = resolveViewRange(params?.from, params?.to, now); } catch { invalidFilter = true; }
  const db = available ? admin() : null;
  const { data: connections, error: connectionError } = db
    ? await db.from("wix_order_connections").select("id,status,last_sync_at,last_error_code,sync_lease_expires_at")
      .eq("workspace_id", access.workspaceId).neq("status", "disconnected").order("created_at", { ascending: false })
    : { data: [], error: null };
  const connection = connections?.[0];
  const { data: reportData, error: factsError } = db && connection && !invalidFilter
    ? await db.rpc("wix_order_history_report", { p_workspace_id: access.workspaceId,
      p_connection_id: connection.id, p_from: view.startDate, p_to: view.endDate })
    : { data: null, error: null };
  const report = reportData as HistoryReport | null;
  const message = result === "connected" ? "Wix connected. Choose a date range to import orders." :
    result === "synced" ? "Selected Wix period imported. Previously saved orders outside that period are retained." :
    result === "disconnected" ? "Wix disconnected and stored order data removed." :
    result === "invalid_range" ? "Choose valid dates ending today or earlier, up to 366 days per import. Older periods can be imported separately." :
    result === "range_too_large" ? "This import was too large or took too long. Choose a smaller range. Previously saved orders are unchanged." :
    result === "error" ? "The Wix action could not be confirmed. Saved history remains available; try a smaller range or reconnect if required." : null;

  return <div className="workspace-page mx-auto max-w-5xl space-y-5">
    <PageHeader eyebrow="Plug-ins" title="Wix online orders" description="Read-only order counts and totals for this workspace."
      actions={<Link href="/app/integrations" aria-label="Back to plug-ins" className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-line bg-white"><ArrowLeft aria-hidden="true" className="h-4 w-4" /></Link>} />
    {message ? <p role={result === "error" || result === "invalid_range" || result === "range_too_large" ? "alert" : "status"} className="rounded-md border border-line p-3 text-sm">{message}</p> : null}
    <SectionCard title="What this connection uses" description="For Wix sites that accept online orders.">
      <div className="space-y-2 text-sm leading-6 text-slate-700">
        <p><strong>Reads:</strong> order dates, order totals, currency, and payment status from Wix eCommerce. Vaeroex saves only these fields and an order ID for deduplication. It does not save customer names, contact details, addresses, notes, or items.</p>
        <p><strong>Requires:</strong> a U.S. Wix site with online ordering enabled, the appropriate Wix site plan to accept payments, and the site owner&apos;s permission to install the Vaeroex Wix app. Wix Restaurants users need Wix Restaurants Orders installed. The Wix site owner pays Wix for their site plan; this connector does not add a Vaeroex API fee.</p>
        <p>Order totals are the values shown on orders. They are not net deposits, settled payments, or accounting revenue. Refund transactions are not included in this first version.</p>
      </div>
    </SectionCard>
    {connection ? <EvidenceMappingLink workspaceId={access.workspaceId} provider={"wix-orders"} connectionId={connection.id} owner={owner} status={connection.status}/> : null}
    <SectionCard title="Connection" description="Only the workspace owner can connect or disconnect a Wix site.">
      {!available ? <p className="text-sm text-slate-600">Wix setup is being completed. Connection will appear here when ready.</p> :
        connectionError ? <p role="alert" className="text-sm text-red-700">Connection status is unavailable.</p> :
        connection ? <div className="space-y-4">
          <div className="flex items-center gap-3"><StatusBadge value={connection.status === "connected" ? "Connected" : connection.status === "pending" ? "Waiting for Wix installation" : "Reconnect required"} /></div>
          {connection.last_error_code ? <p role="status" className="text-sm text-amber-800">The last update failed. Try importing again or reconnect the Wix site.</p> : null}
          {connection.status === "connected" && owner ? <div className="space-y-4">
            <form method="post" action="/api/integrations/wix-orders/sync" className="space-y-3">
              <input type="hidden" name="connectionId" value={connection.id} />
              <h3 className="font-semibold">Import orders</h3>
              <p className="text-sm text-slate-600">Choose up to 366 calendar days per import, including older years. Import additional periods to build your history. Re-importing a period updates its saved orders without duplicates. Large periods may need smaller imports.</p>
              <DateRangeFields idPrefix="wix-import" defaultStartDate={defaultRange.startDate} defaultEndDate={defaultRange.endDate} maxDate={today} />
              <button type="submit" disabled={Boolean(connection.sync_lease_expires_at && Date.parse(connection.sync_lease_expires_at) > Date.now())}
                className="min-h-11 rounded-md border border-line px-4 py-2 font-semibold text-vaeroex-blue disabled:opacity-50">Import selected dates</button>
            </form>
            <form method="post" action="/api/integrations/wix-orders/disconnect">
              <input type="hidden" name="connectionId" value={connection.id} /><input type="hidden" name="confirmation" value="disconnect" />
              <button type="submit" className="min-h-11 rounded-md border border-line px-4 py-2 font-semibold text-red-700">Disconnect and remove orders</button>
            </form>
          </div> : null}
          {(connection.status === "pending" || connection.status === "reauthorization_required") && owner ? <form method="post" action="/api/integrations/wix-orders/disconnect">
            <input type="hidden" name="connectionId" value={connection.id} /><input type="hidden" name="confirmation" value="disconnect" />
            <button type="submit" className="min-h-11 rounded-md border border-line px-4 py-2 font-semibold text-red-700">Clear connection and try again</button>
          </form> : null}
          {connection.last_sync_at ? <p className="text-sm text-slate-600">Last sync: {new Date(connection.last_sync_at).toLocaleString("en-US", { timeZone: "UTC" })} UTC</p> : null}
        </div> : owner ? <form method="post" action="/api/integrations/wix-orders/connect">
          <button type="submit" className="min-h-11 rounded-md border border-line px-4 py-2 font-semibold text-vaeroex-blue">Connect a Wix site</button>
        </form> : <p className="text-sm text-slate-600">The workspace owner can connect a Wix site.</p>}
    </SectionCard>
    {connection ? <SectionCard title="Saved order history" description="Filter orders already imported into this workspace. Filtering does not fetch from Wix.">
      <div className="space-y-4">
        <SavedHistoryFilter action="/app/integrations/wix-orders" startDate={view.startDate} endDate={view.endDate} maxDate={today} />
        <p className="text-sm text-slate-600">Saved history remains when you log out. Disconnecting and removing orders erases it. Totals reflect approved orders when last imported; re-import a period to retrieve changes.</p>
        {invalidFilter ? <p role="alert" className="text-sm text-red-700">Choose a valid start and end date for the report.</p> :
          factsError || !report ? <p role="alert" className="text-sm text-red-700">Saved order data is unavailable.</p> : <>
            <div className="space-y-2 text-sm text-slate-600">
              <p>{report.complete_days} complete imported days{report.covered_days > report.complete_days ? ` and ${report.covered_days - report.complete_days} partially imported days` : ""} in this view.</p>
              {report.requested_days !== null && report.requested_days > report.covered_days ? <p role="status" className="text-amber-800">{report.requested_days - report.covered_days} selected days have no completed import. Missing periods are not zero activity.</p> : null}
              {report.coverage.length ? <details><summary className="cursor-pointer font-semibold">View imported periods</summary><ul className="mt-2 space-y-1">{report.coverage.map((period) => <li key={`${period.start_date}-${period.end_date}`}>{period.start_date} through {period.end_date} UTC{period.complete ? " · complete days" : ` · partial, read through ${new Date(period.imported_through).toLocaleString("en-US", { timeZone: "UTC" })} UTC`}</li>)}</ul></details> : <p>No date range has a verified complete import yet. Re-import older saved orders to establish coverage.</p>}
              <p>Only the listed imported periods are covered. Earlier saved orders may appear in totals without verified coverage.</p>
            </div>
            {report.totals.length === 0 ? <p className="text-sm text-slate-600">No saved approved orders in this view. Check imported coverage before treating this as no activity.</p> :
              <div className="grid gap-4 sm:grid-cols-2">{report.totals.map((totals) => <div key={totals.currency_code} className="rounded-md border border-line p-4">
                <p className="text-sm font-semibold text-ink">{totals.currency_code}</p>
                <p className="mt-1 text-2xl font-semibold text-ink">{new Intl.NumberFormat("en-US", { style: "currency", currency: totals.currency_code }).format(Number(totals.total_amount))}</p>
                <p className="text-sm text-slate-600">{totals.order_count} orders · {totals.paid_count} marked paid</p>
              </div>)}</div>}
          </>}
      </div>
    </SectionCard> : null}
  </div>;
}
