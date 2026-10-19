import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { activeToken, admin, enabled, organizations } from "@/lib/integrations/zoho-books/server";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";
import { resolveImportRange, resolveViewRange } from "@/lib/integrations/date-range";
import { DateRangeFields, SavedHistoryFilter } from "@/components/integrations/DateRangeFields";

export const dynamic = "force-dynamic";

type PageProps = { searchParams?: Promise<{ result?: string; from?: string; to?: string }> };
type History = { invoice_count: number; invoice_total: number; outstanding_total: number; expense_count: number;
  expense_total: number; excluded_foreign_count: number; covered_days: number; complete_days: number; incomplete_days: number; latest_covered_through: string | null; missing_days: number; start: string | null; end: string | null;
  legacy: { days: number; start: string | null; end: string | null; invoice_total: number; expense_total: number; outstanding_total: number } };

export default async function ZohoBooksPage({ searchParams }: PageProps) {
  const access = await requireWorkspacePage();
  const owner = access.context.membership?.role === "owner";
  const available = enabled();
  const params = await searchParams;
  const now = new Date(), defaultRange = resolveImportRange(null, null, now), maxDate = now.toISOString().slice(0, 10);
  let filter: ReturnType<typeof resolveViewRange> = { startDate: null, endDate: null }, invalidFilter = false;
  try { filter = resolveViewRange(params?.from, params?.to, now); } catch { invalidFilter = true; }
  const db = available ? admin() : null;
  const { data: connections, error: connectionError } = db
    ? await db.from("zoho_books_connections")
      .select("id,status,organization_name,last_sync_at,last_error_code,sync_lease_expires_at")
      .eq("workspace_id", access.workspaceId).neq("status", "disconnected").order("created_at", { ascending: false })
    : { data: [], error: null };
  const connection = connections?.[0];
  const canViewHistory = connection && ["connected", "reauthorization_required"].includes(connection.status);
  const { data: historyData, error: summaryError } = db && canViewHistory && !invalidFilter
    ? await db.rpc("read_zoho_books_history", { p_workspace_id: access.workspaceId, p_connection_id: connection.id,
      p_start_date: filter.startDate, p_end_date: filter.endDate })
    : { data: null, error: null };
  const history = historyData as History | null;
  let choices: Awaited<ReturnType<typeof organizations>> = [];
  let choiceError = false;
  if (owner && connection?.status === "choose_organization") {
    try { choices = await organizations(await activeToken(access.workspaceId, connection.id)); }
    catch { choiceError = true; }
  }
  const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
  const status = connection?.status === "connected" ? "Connected" : connection?.status === "choose_organization" ?
    "Choose an organization" : connection?.status === "reauthorization_required" ? "Reauthorization required" : "Waiting for authorization";

  return <div className="workspace-page mx-auto max-w-5xl space-y-5">
    <PageHeader eyebrow="Plug-ins" title="Zoho Books" description="Import and keep invoice and expense history for your workspace."
      actions={<Link href="/app/integrations" aria-label="Back to plug-ins" className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-line bg-white"><ArrowLeft aria-hidden="true" className="h-4 w-4" /></Link>} />
    {params?.result === "error" ? <p role="alert" className="rounded-md border border-line p-3 text-sm">The Zoho Books action could not be confirmed. Check saved history and the last import time before trying a smaller range or checking account access.</p> : null}
    {params?.result === "invalid_range" ? <p role="alert" className="rounded-md border border-line p-3 text-sm">Choose both dates, ending today or earlier, with at most 366 calendar days per import. Older periods can be imported in separate ranges.</p> : null}
    {params?.result === "synced" ? <p role="status" className="rounded-md border border-line p-3 text-sm">The selected period was imported. Previously imported dates outside that period are retained.</p> : null}
    {params?.result === "disconnected" ? <p role="status" className="rounded-md border border-line p-3 text-sm">Zoho Books disconnected and stored history removed.</p> : null}
    <SectionCard title="Connection" description="For U.S. Zoho Books organizations. Vaeroex requests read-only access to organization settings, invoices, and expenses.">
      {!available ? <p className="text-sm text-slate-600">Zoho Books setup is not complete yet.</p> :
        connectionError ? <p role="alert" className="text-sm text-red-700">Connection status is unavailable.</p> :
        connection ? <div className="space-y-4">
          <div className="flex items-center gap-3"><StatusBadge value={status} />
            <span className="text-sm text-slate-600">{connection.organization_name ?? "Zoho Books account"}</span></div>
          {connection.status === "pending" && owner ? <p className="text-sm text-slate-600">Finish authorization in Zoho Books. If you closed that page, cancel this attempt and connect again.</p> : null}
          {connection.status === "choose_organization" && owner ? choiceError ?
            <p role="alert" className="text-sm text-red-700">Could not load organizations. Disconnect and try again.</p> :
            <form method="post" action="/api/integrations/zoho-books/select-organization" className="space-y-3">
              <input type="hidden" name="connectionId" value={connection.id} />
              <label htmlFor="zoho-organization" className="block text-sm font-semibold">Zoho Books organization</label>
              <select id="zoho-organization" name="organizationId" required className="min-h-11 w-full rounded-md border border-line bg-white px-3 py-2">
                <option value="">Choose one</option>
                {choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.name}</option>)}
              </select>
              <button type="submit" className="min-h-11 rounded-md border border-line px-4 py-2 font-semibold text-vaeroex-blue">Use this organization</button>
            </form> : null}
          {connection.last_error_code ? <p role="status" className="text-sm text-amber-800">The last update failed. Saved history is retained. Try a smaller range or reconnect if authorization has expired.</p> : null}
          {connection.status === "connected" && owner ? <form method="post" action="/api/integrations/zoho-books/sync" className="space-y-3">
            <input type="hidden" name="connectionId" value={connection.id} />
            <DateRangeFields idPrefix="zoho-books-import" defaultStartDate={defaultRange.startDate} defaultEndDate={defaultRange.endDate} maxDate={maxDate} />
            <p className="text-xs text-slate-600">Import up to 366 calendar days at a time. Choose any older period; busy periods may need smaller ranges. Re-importing a period replaces its saved records and updates matching records without duplicates.</p>
            <button type="submit" disabled={Boolean(connection.sync_lease_expires_at && Date.parse(connection.sync_lease_expires_at) > Date.now())}
              className="min-h-11 rounded-md border border-line px-4 py-2 font-semibold text-vaeroex-blue disabled:opacity-50">Import selected dates</button>
          </form> : null}
          {connection.status === "reauthorization_required" && owner ? <form method="post" action="/api/integrations/zoho-books/connect">
            <button type="submit" className="min-h-11 rounded-md border border-line px-4 py-2 font-semibold text-vaeroex-blue">Reconnect Zoho Books</button>
          </form> : null}
          {owner ? <form method="post" action="/api/integrations/zoho-books/disconnect">
            <input type="hidden" name="connectionId" value={connection.id} />
            <input type="hidden" name="confirmation" value="disconnect" />
            <button type="submit" className="min-h-11 rounded-md border border-line px-4 py-2 font-semibold text-red-700">{connection.status === "pending" ? "Cancel connection attempt" : "Disconnect and remove history"}</button>
          </form> : null}
          {connection.last_sync_at ? <p className="text-sm text-slate-600">Last sync: {new Date(connection.last_sync_at).toLocaleString("en-US", { timeZone: "UTC" })} UTC</p> : null}
        </div> : owner ? <form method="post" action="/api/integrations/zoho-books/connect">
          <button type="submit" className="min-h-11 rounded-md border border-line px-4 py-2 font-semibold text-vaeroex-blue">Connect Zoho Books</button>
        </form> : <p className="text-sm text-slate-600">The workspace owner can connect Zoho Books.</p>}
    </SectionCard>
    {canViewHistory ? <SectionCard title="Saved accounting history" description="View saved USD activity by invoice or expense date. Filtering does not request another import.">
      <SavedHistoryFilter action="/app/integrations/zoho-books" startDate={filter.startDate} endDate={filter.endDate} maxDate={maxDate} />
      {invalidFilter ? <p role="alert" className="text-sm text-red-700">Choose a valid start and end date for the saved-history filter.</p> :
        summaryError ? <p role="alert" className="text-sm text-red-700">Accounting history is unavailable.</p> :
        !history?.covered_days ? <p className="mt-4 text-sm text-slate-600">No completed import covers these dates yet. Import a period above to view its history; missing dates are not zero activity.</p> : <>
          <p className="my-4 text-sm text-slate-600">{history.covered_days} imported calendar dates from {history.start} through {history.end} (UTC): {history.complete_days} full dates and {history.incomplete_days} partial dates. Latest saved coverage cutoff: {history.latest_covered_through ? new Date(history.latest_covered_through).toLocaleString("en-US", { timeZone: "UTC" }) : "Unavailable"} UTC.</p>
          {history.incomplete_days > 0 ? <p role="status" className="mb-4 text-sm text-amber-800">{history.incomplete_days} imported dates cover only part of the day. Re-import those dates after they end to complete them; waiting or signing in again does not fill the missing hours.</p> : null}
          {history.missing_days > 0 ? <p role="status" className="mb-4 text-sm text-amber-800">{history.missing_days} dates in this range have not been imported. Totals below cover saved records only; missing dates are not zero activity.</p> : null}
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div><dt className="text-sm text-slate-600">Issued invoices</dt><dd className="text-2xl font-semibold text-ink">{money(Number(history.invoice_total))}</dd><p className="text-xs text-slate-600">{history.invoice_count} invoices</p></div>
            <div><dt className="text-sm text-slate-600">Outstanding when imported</dt><dd className="text-2xl font-semibold text-ink">{money(Number(history.outstanding_total))}</dd><p className="text-xs text-slate-600">Balance observed on each saved invoice&apos;s last import, not a historical balance as of the selected dates.</p></div>
            <div><dt className="text-sm text-slate-600">Recorded expenses</dt><dd className="text-2xl font-semibold text-ink">{money(Number(history.expense_total))}</dd><p className="text-xs text-slate-600">{history.expense_count} expenses</p></div>
            <div><dt className="text-sm text-slate-600">Other currencies omitted</dt><dd className="text-2xl font-semibold text-ink">{history.excluded_foreign_count}</dd></div>
          </dl>
        </>}
      {history?.legacy.days ? <details className="mt-4 rounded-md border border-line p-3 text-sm"><summary>Earlier saved summary: {history.legacy.start} through {history.legacy.end}</summary>
        <p className="mt-2">{history.legacy.days} dates remain from the earlier summary format. Issued invoices: {money(Number(history.legacy.invoice_total))}; outstanding when imported: {money(Number(history.legacy.outstanding_total))}; expenses: {money(Number(history.legacy.expense_total))}. These figures are shown separately to avoid double counting. Import these dates again to include them in saved history.</p>
      </details> : null}
      <p className="mt-4 text-xs text-slate-600">Saved history remains when you sign out. Re-import a period to update changed or removed records. Invoice totals are amounts billed, not recognized revenue or cash received; they do not calculate profit. Draft and void invoices are excluded. Vaeroex stores provider record IDs, dates, currency codes and numeric totals, without customer, vendor, descriptions or line-item details. Disconnecting removes this history.</p>
    </SectionCard> : null}
  </div>;
}
