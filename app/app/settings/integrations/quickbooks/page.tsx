import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText, ShieldCheck } from "lucide-react";
import { AuthMessage } from "@/components/auth/AuthMessage";
import { ConnectionStatusPanel } from "@/components/integrations/ConnectionStatusPanel";
import { PageHeader } from "@/components/operations/PageHeader";
import { qboProductionCustomerConnectionsEnabled } from "@/lib/integrations/control-plane/qbo-customer-availability";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";
import { readQuickBooksStatus } from "@/app/app/integrations/_qbo";

export const dynamic = "force-dynamic";

export default async function QuickBooksManagementPage({ searchParams }: {
  searchParams?: Promise<{ result?: string | string[]; error?: string | string[] }>;
} = {}) {
  if (!qboProductionCustomerConnectionsEnabled()) notFound();
  const params = await searchParams;
  const access = await requireWorkspacePage();
  const canManage = access.context.membership?.role === "owner";
  const [status, entities] = await Promise.all([
    readQuickBooksStatus(access),
    canManage ? access.supabase.from("business_entities")
      .select("id, display_name").eq("workspace_id", access.workspaceId)
      .eq("status", "active").order("display_name", { ascending: true })
      : { data: [], error: null }
  ]);

  return (
    <div className="workspace-page mx-auto max-w-5xl space-y-5">
      <PageHeader eyebrow="Integrations" title="QuickBooks Online" description="Connection health and data freshness for this workspace."
        actions={<Link href="/app/integrations" title="Back to integrations" aria-label="Back to integrations"
          className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-line bg-white text-ink hover:bg-slate-50">
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        </Link>} />
      <AuthMessage
        message={params?.result === "cancelled" ? "The QuickBooks connection attempt was cancelled." : undefined}
        error={params?.error === "cancel_failed" ? "This QuickBooks attempt could not be cancelled. Review its current status and try again." : undefined}
      />
      <section aria-label="QuickBooks connections" className="space-y-4 border-y border-line py-4">
        {status ? <ConnectionStatusPanel connections={status.connections} freshness={status.freshness}
          businessEntities={entities.data ?? []} canManage={canManage} />
          : <p role="status" className="text-sm text-muted">QuickBooks connection status is unavailable. Try again later.</p>}
        {canManage && entities.error ? <p role="status" className="text-sm text-muted">Business entities are unavailable. Connecting requires an active business entity.</p> : null}
        {canManage && !entities.error && !entities.data?.length ? <p className="text-sm text-muted">An active business entity is required to connect QuickBooks.</p> : null}
      </section>
      {canManage ? <nav aria-label="QuickBooks management" className="flex flex-wrap gap-4">
        <Link href="/app/settings/integrations/quickbooks/data" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-vaeroex-blue">
          <FileText aria-hidden="true" className="h-4 w-4 shrink-0" />View stored QuickBooks data
        </Link>
        <Link href="/app/settings/integrations/quickbooks/accounting" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-vaeroex-blue">
          <ShieldCheck aria-hidden="true" className="h-4 w-4 shrink-0" />Accounting authority
        </Link>
      </nav> : null}
    </div>
  );
}
