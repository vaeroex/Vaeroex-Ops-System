import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { activeToken, admin, enabled, organizations } from "@/lib/integrations/zoho-books/server";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

export const dynamic = "force-dynamic";

type PageProps = { searchParams?: Promise<{ result?: string }> };

export default async function ZohoBooksPage({ searchParams }: PageProps) {
  const access = await requireWorkspacePage();
  const owner = access.context.membership?.role === "owner";
  const available = enabled();
  const params = await searchParams;
  const db = available ? admin() : null;
  const { data: connections, error: connectionError } = db
    ? await db.from("zoho_books_connections")
      .select("id,status,organization_name,last_sync_at,last_error_code,sync_lease_expires_at")
      .eq("workspace_id", access.workspaceId).neq("status", "disconnected").order("created_at", { ascending: false })
    : { data: [], error: null };
  const connection = connections?.[0];
  const { data: daily, error: summaryError } = db && connection?.status === "connected"
    ? await db.from("zoho_books_daily_summaries")
      .select("day,invoice_count,invoice_total,outstanding_total,expense_count,expense_total,excluded_foreign_count")
      .eq("workspace_id", access.workspaceId).eq("connection_id", connection.id)
      .gte("day", new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10))
      .order("day", { ascending: false }).limit(7)
    : { data: [], error: null };
  let choices: Awaited<ReturnType<typeof organizations>> = [];
  let choiceError = false;
  if (owner && connection?.status === "choose_organization") {
    try { choices = await organizations(await activeToken(access.workspaceId, connection.id)); }
    catch { choiceError = true; }
  }
  const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
  const sum = (field: "invoice_total" | "outstanding_total" | "expense_total" | "invoice_count" | "expense_count" | "excluded_foreign_count") =>
    (daily ?? []).reduce((total, row) => total + Number(row[field]), 0);
  const status = connection?.status === "connected" ? "Connected" : connection?.status === "choose_organization" ?
    "Choose an organization" : connection?.status === "reauthorization_required" ? "Reauthorization required" : "Waiting for authorization";

  return <div className="workspace-page mx-auto max-w-5xl space-y-5">
    <PageHeader eyebrow="Plug-ins" title="Zoho Books" description="Recent invoice and expense totals for your workspace."
      actions={<Link href="/app/integrations" aria-label="Back to plug-ins" className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-line bg-white"><ArrowLeft aria-hidden="true" className="h-4 w-4" /></Link>} />
    {params?.result === "error" ? <p role="alert" className="rounded-md border border-line p-3 text-sm">The Zoho Books action did not complete. Check the organization and authorization, then try again.</p> : null}
    {params?.result === "disconnected" ? <p role="status" className="rounded-md border border-line p-3 text-sm">Zoho Books disconnected and stored summaries removed.</p> : null}
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
          {connection.last_error_code ? <p role="status" className="text-sm text-amber-800">The last update failed. Try syncing again or reconnect if authorization has expired.</p> : null}
          {connection.status === "connected" && owner ? <form method="post" action="/api/integrations/zoho-books/sync">
            <input type="hidden" name="connectionId" value={connection.id} />
            <button type="submit" disabled={Boolean(connection.sync_lease_expires_at && Date.parse(connection.sync_lease_expires_at) > Date.now())}
              className="min-h-11 rounded-md border border-line px-4 py-2 font-semibold text-vaeroex-blue disabled:opacity-50">Sync last seven dates</button>
          </form> : null}
          {connection.status === "reauthorization_required" && owner ? <form method="post" action="/api/integrations/zoho-books/connect">
            <button type="submit" className="min-h-11 rounded-md border border-line px-4 py-2 font-semibold text-vaeroex-blue">Reconnect Zoho Books</button>
          </form> : null}
          {owner ? <form method="post" action="/api/integrations/zoho-books/disconnect">
            <input type="hidden" name="connectionId" value={connection.id} />
            <input type="hidden" name="confirmation" value="disconnect" />
            <button type="submit" className="min-h-11 rounded-md border border-line px-4 py-2 font-semibold text-red-700">{connection.status === "pending" ? "Cancel connection attempt" : "Disconnect and remove summaries"}</button>
          </form> : null}
          {connection.last_sync_at ? <p className="text-sm text-slate-600">Last sync: {new Date(connection.last_sync_at).toLocaleString("en-US", { timeZone: "UTC" })} UTC</p> : null}
        </div> : owner ? <form method="post" action="/api/integrations/zoho-books/connect">
          <button type="submit" className="min-h-11 rounded-md border border-line px-4 py-2 font-semibold text-vaeroex-blue">Connect Zoho Books</button>
        </form> : <p className="text-sm text-slate-600">The workspace owner can connect Zoho Books.</p>}
    </SectionCard>
    {connection?.status === "connected" ? <SectionCard title="Recent accounting activity" description="Seven calendar dates ending today in UTC. USD transactions only.">
      {summaryError ? <p role="alert" className="text-sm text-red-700">Accounting summary is unavailable.</p> :
        !connection.last_sync_at ? <p className="text-sm text-slate-600">Sync to view recent activity.</p> :
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-sm text-slate-600">Issued invoices</dt><dd className="text-2xl font-semibold text-ink">{money(sum("invoice_total"))}</dd><p className="text-xs text-slate-600">{sum("invoice_count")} invoices</p></div>
          <div><dt className="text-sm text-slate-600">Still outstanding</dt><dd className="text-2xl font-semibold text-ink">{money(sum("outstanding_total"))}</dd></div>
          <div><dt className="text-sm text-slate-600">Recorded expenses</dt><dd className="text-2xl font-semibold text-ink">{money(sum("expense_total"))}</dd><p className="text-xs text-slate-600">{sum("expense_count")} expenses</p></div>
          <div><dt className="text-sm text-slate-600">Other currencies omitted</dt><dd className="text-2xl font-semibold text-ink">{sum("excluded_foreign_count")}</dd></div>
        </dl>}
      <p className="mt-4 text-xs text-slate-600">Invoice totals are amounts billed, not recognized revenue or cash received. These totals do not calculate profit. Draft and void invoices are excluded. Vaeroex stores daily totals and counts, not customer, vendor, invoice, or expense details.</p>
    </SectionCard> : null}
  </div>;
}
