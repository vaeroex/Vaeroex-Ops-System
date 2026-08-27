import Link from "next/link";
import { ArrowLeft, Unplug } from "lucide-react";

import { AuthMessage } from "@/components/auth/AuthMessage";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { QBO_CUSTOMER_SETTINGS_PATH } from "@/lib/integrations/control-plane/qbo-customer-routes";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

type DisconnectPageProps = {
  searchParams?: Promise<{
    error?: string;
    result?: string;
  }>;
};

const resultMessages: Readonly<Record<string, string>> = {
  requested:
    "QuickBooks disconnect requested. Vaeroex access is disabled while credential revocation completes.",
  in_progress: "QuickBooks disconnect is already in progress.",
  disconnected: "QuickBooks is disconnected."
};

const errorMessages: Readonly<Record<string, string>> = {
  not_permitted: "Your workspace role cannot disconnect QuickBooks.",
  unavailable: "That QuickBooks connection is unavailable for disconnect.",
  failed: "QuickBooks could not be disconnected. Review its status and try again."
};

const disconnectableStatuses = new Set([
  "authorized_unmapped",
  "initializing",
  "active",
  "degraded",
  "reauthorization_required"
]);

function statusLabel(status: string) {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default async function QuickBooksDisconnectPage({
  searchParams
}: DisconnectPageProps) {
  const params = await searchParams;
  const { context, supabase, workspaceId } = await requireWorkspacePage();
  const canManage = ["owner", "admin", "manager"].includes(
    context.membership?.role ?? ""
  );
  const { data: connections } = await supabase
    .from("integration_connection_summaries")
    .select("id,safe_display_name,status,status_changed_at")
    .eq("workspace_id", workspaceId)
    .eq("provider_key", "quickbooks_online")
    .eq("provider_environment", "production")
    .neq("status", "deleted")
    .order("status_changed_at", { ascending: false });
  const message = params?.result ? resultMessages[params.result] : undefined;
  const error = params?.error ? errorMessages[params.error] : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Accounting connection"
        title="Disconnect QuickBooks"
        description="Manage the QuickBooks connection for this workspace."
        actions={
          <Link
            href={QBO_CUSTOMER_SETTINGS_PATH}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-line text-ink hover:bg-slate-50"
            title="Back to settings"
            aria-label="Back to settings"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          </Link>
        }
      />

      <AuthMessage error={error} message={message} />

      <SectionCard
        title="QuickBooks Online"
        description="Disconnecting disables provider access and synchronization. Historical Vaeroex records and audit evidence remain unchanged."
      >
        {connections?.length ? (
          <div className="divide-y divide-line border-y border-line">
            {connections.map((connection) => {
              const canDisconnect =
                canManage && disconnectableStatuses.has(connection.status);
              return (
                <div
                  key={connection.id}
                  className="grid gap-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">
                      {connection.safe_display_name}
                    </p>
                    <div className="mt-2">
                      <StatusBadge value={statusLabel(connection.status)} />
                    </div>
                  </div>
                  {canDisconnect ? (
                    <form
                      action="/api/integrations/qbo/disconnect"
                      method="post"
                      className="space-y-3 sm:max-w-sm"
                    >
                      <input
                        type="hidden"
                        name="connectionId"
                        value={connection.id}
                      />
                      <label className="flex items-start gap-2 text-sm text-slate-700">
                        <input
                          required
                          type="checkbox"
                          name="confirmation"
                          value="disconnect"
                          className="mt-1 h-4 w-4"
                        />
                        <span>Confirm this QuickBooks disconnect.</span>
                      </label>
                      <button
                        type="submit"
                        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
                      >
                        <Unplug aria-hidden="true" className="h-4 w-4" />
                        Disconnect QuickBooks
                      </button>
                    </form>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted">
            No QuickBooks connection is available in this workspace.
          </p>
        )}
      </SectionCard>
    </div>
  );
}
