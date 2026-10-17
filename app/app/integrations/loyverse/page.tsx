import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { admin, enabled } from "@/lib/integrations/loyverse/server";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

export const dynamic = "force-dynamic";

type PageProps = { searchParams?: Promise<{ result?: string }> };

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
  const { data: facts, error: factsError } = db && connection?.status === "connected"
    ? await db.from("loyverse_receipt_facts")
      .select("receipt_type,total_money,total_tax,total_discount,cancelled,receipt_date,store_id")
      .eq("workspace_id", access.workspaceId).eq("connection_id", connection.id)
      .gte("receipt_date", new Date(Date.now() - 7 * 86_400_000).toISOString()).limit(5000)
    : { data: [], error: null };
  const valid = (facts ?? []).filter((fact) => !fact.cancelled);
  const sales = valid.filter((fact) => fact.receipt_type === "SALE");
  const refunds = valid.filter((fact) => fact.receipt_type === "REFUND");
  const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: connection?.currency_code ?? "USD" }).format(n);
  const sum = (values: typeof valid, field: "total_money" | "total_tax" | "total_discount") =>
    values.reduce((total, row) => total + Number(row[field]), 0);
  const net = sum(sales, "total_money") - sum(refunds, "total_money");
  const resultMessage = params?.result === "connected" ? "Loyverse connected. Sync to load recent sales." :
    params?.result === "synced" ? "Recent sales updated." :
    params?.result === "disconnected" ? "Loyverse disconnected and stored sales removed." :
    params?.result === "error" ? "The Loyverse action did not complete. Please try again." : null;

  return <div className="workspace-page mx-auto max-w-5xl space-y-5">
    <PageHeader eyebrow="Integrations" title="Loyverse" description="Read only point of sale totals for your workspace."
      actions={<Link href="/app/integrations" aria-label="Back to integrations" className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-line bg-white"><ArrowLeft aria-hidden="true" className="h-4 w-4" /></Link>} />
    {resultMessage ? <p role={params?.result === "error" ? "alert" : "status"} className="rounded-md border border-line p-3 text-sm">{resultMessage}</p> : null}
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
          {connection.last_error_code ? <p role="status" className="text-sm text-amber-800">The last update failed. Try syncing again or reconnect if authorization has expired.</p> : null}
          {connection.status === "connected" && owner ? <div className="flex flex-wrap gap-3">
            <form method="post" action="/api/integrations/loyverse/sync">
              <input type="hidden" name="connectionId" value={connection.id} />
              <button type="submit" disabled={Boolean(connection.sync_lease_expires_at && Date.parse(connection.sync_lease_expires_at) > Date.now())}
                className="min-h-11 rounded-md border border-line px-4 py-2 font-semibold text-vaeroex-blue disabled:opacity-50">Sync last seven days</button>
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
    {connection?.status === "connected" ? <SectionCard title="Recent sales" description="Seven day totals from Loyverse receipts. Refunds reduce net sales; cancelled receipts are excluded.">
      {factsError ? <p role="alert" className="text-sm text-red-700">Sales data is unavailable.</p> :
        !connection.last_sync_at ? <p className="text-sm text-slate-600">Sync to view sales.</p> :
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-sm text-slate-600">Net receipts</dt><dd className="text-2xl font-semibold text-ink">{money(net)}</dd></div>
          <div><dt className="text-sm text-slate-600">Sales</dt><dd className="text-2xl font-semibold text-ink">{money(sum(sales, "total_money"))}</dd></div>
          <div><dt className="text-sm text-slate-600">Refunds</dt><dd className="text-2xl font-semibold text-ink">{money(sum(refunds, "total_money"))}</dd></div>
          <div><dt className="text-sm text-slate-600">Receipts</dt><dd className="text-2xl font-semibold text-ink">{valid.length}</dd></div>
        </dl>}
      <p className="mt-4 text-xs text-slate-600">Totals include tax and tips where Loyverse includes them. This view does not store customer, employee, payment, note, or line item details.</p>
    </SectionCard> : null}
  </div>;
}
