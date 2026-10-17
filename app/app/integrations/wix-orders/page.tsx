import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { admin, enabled } from "@/lib/integrations/wix-orders/server";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

export const dynamic = "force-dynamic";

export default async function WixOrdersPage({ searchParams }: { searchParams?: Promise<{ result?: string }> }) {
  const access = await requireWorkspacePage();
  const owner = access.context.membership?.role === "owner";
  const available = enabled();
  const result = (await searchParams)?.result;
  const db = available ? admin() : null;
  const { data: connections, error: connectionError } = db
    ? await db.from("wix_order_connections").select("id,status,last_sync_at,last_error_code,sync_lease_expires_at")
      .eq("workspace_id", access.workspaceId).neq("status", "disconnected").order("created_at", { ascending: false })
    : { data: [], error: null };
  const connection = connections?.[0];
  const { data: facts, error: factsError } = db && connection?.status === "connected"
    ? await db.from("wix_order_facts").select("created_at,total_amount,currency_code,payment_status")
      .eq("workspace_id", access.workspaceId).eq("connection_id", connection.id)
      .gte("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString()).limit(5000)
    : { data: [], error: null };
  const currencyTotals = new Map<string, { count: number; value: number; paidCount: number }>();
  for (const fact of facts ?? []) {
    const current = currencyTotals.get(fact.currency_code) ?? { count: 0, value: 0, paidCount: 0 };
    current.count++;
    current.value += Number(fact.total_amount);
    if (fact.payment_status === "PAID") current.paidCount++;
    currencyTotals.set(fact.currency_code, current);
  }
  const message = result === "connected" ? "Wix connected. Sync to load recent orders." :
    result === "synced" ? "Recent Wix orders updated." :
    result === "disconnected" ? "Wix disconnected and stored order data removed." :
    result === "error" ? "The Wix action did not complete. Please try again." : null;

  return <div className="workspace-page mx-auto max-w-5xl space-y-5">
    <PageHeader eyebrow="Plug-ins" title="Wix online orders" description="Read-only order counts and totals for this workspace."
      actions={<Link href="/app/integrations" aria-label="Back to plug-ins" className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-line bg-white"><ArrowLeft aria-hidden="true" className="h-4 w-4" /></Link>} />
    {message ? <p role={result === "error" ? "alert" : "status"} className="rounded-md border border-line p-3 text-sm">{message}</p> : null}
    <SectionCard title="What this connection uses" description="For Wix sites that accept online orders.">
      <div className="space-y-2 text-sm leading-6 text-slate-700">
        <p><strong>Reads:</strong> order dates, order totals, currency, and payment status from Wix eCommerce. Vaeroex saves only these fields and an order ID for deduplication. It does not save customer names, contact details, addresses, notes, or items.</p>
        <p><strong>Requires:</strong> a U.S. Wix site with online ordering enabled, the appropriate Wix site plan to accept payments, and the site owner&apos;s permission to install the Vaeroex Wix app. Wix Restaurants users need Wix Restaurants Orders installed. The Wix site owner pays Wix for their site plan; this connector does not add a Vaeroex API fee.</p>
        <p>Order totals are the values shown on orders. They are not net deposits, settled payments, or accounting revenue. Refund transactions are not included in this first version.</p>
      </div>
    </SectionCard>
    <SectionCard title="Connection" description="Only the workspace owner can connect or disconnect a Wix site.">
      {!available ? <p className="text-sm text-slate-600">Wix setup is being completed. Connection will appear here when ready.</p> :
        connectionError ? <p role="alert" className="text-sm text-red-700">Connection status is unavailable.</p> :
        connection ? <div className="space-y-4">
          <div className="flex items-center gap-3"><StatusBadge value={connection.status === "connected" ? "Connected" : connection.status === "pending" ? "Waiting for Wix installation" : "Reconnect required"} /></div>
          {connection.last_error_code ? <p role="status" className="text-sm text-amber-800">The last update failed. Try syncing again or reconnect the Wix site.</p> : null}
          {connection.status === "connected" && owner ? <div className="flex flex-wrap gap-3">
            <form method="post" action="/api/integrations/wix-orders/sync">
              <input type="hidden" name="connectionId" value={connection.id} />
              <button type="submit" disabled={Boolean(connection.sync_lease_expires_at && Date.parse(connection.sync_lease_expires_at) > Date.now())}
                className="min-h-11 rounded-md border border-line px-4 py-2 font-semibold text-vaeroex-blue disabled:opacity-50">Sync last seven days</button>
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
    {connection?.status === "connected" ? <SectionCard title="Recent orders" description="Orders created in the last seven days, grouped by currency.">
      {factsError ? <p role="alert" className="text-sm text-red-700">Order data is unavailable.</p> :
        !connection.last_sync_at ? <p className="text-sm text-slate-600">Sync to view orders.</p> :
        currencyTotals.size === 0 ? <p className="text-sm text-slate-600">No orders found in the last seven days.</p> :
        <div className="grid gap-4 sm:grid-cols-2">{[...currencyTotals].map(([currency, totals]) => <div key={currency} className="rounded-md border border-line p-4">
          <p className="text-sm font-semibold text-ink">{currency}</p>
          <p className="mt-1 text-2xl font-semibold text-ink">{new Intl.NumberFormat("en-US", { style: "currency", currency }).format(totals.value)}</p>
          <p className="text-sm text-slate-600">{totals.count} orders · {totals.paidCount} marked paid</p>
        </div>)}</div>}
    </SectionCard> : null}
  </div>;
}
