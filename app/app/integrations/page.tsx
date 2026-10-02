import { headers } from "next/headers";
import { PageHeader } from "@/components/operations/PageHeader";
import { customerConnectionStatus } from "@/lib/integrations/control-plane/customer-status";
import { qboProductionCustomerConnectionsEnabled } from "@/lib/integrations/control-plane/qbo-customer-availability";
import { readSquareWorkspaceEvidence } from "@/lib/integrations/control-plane/square-workspace-evidence";
import { squareDirectEnabled, squareDirectView, squareSettingsPath } from "@/lib/integrations/square-direct/server";
import type { DirectView } from "@/lib/integrations/square-direct/contracts";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";
import { ProviderCard } from "./_ProviderCard";
import { readQuickBooksStatus } from "./_qbo";

export const dynamic = "force-dynamic";

const squareLabels: Record<DirectView["connections"][number]["state"], string> = {
  consent_pending: "Waiting for Square authorization",
  exchanging: "Finishing Square authorization",
  mapping_required: "Choose a Square location",
  connected: "Connected",
  syncing: "Reading Square Payments",
  retry_required: "Payments update needs another attempt",
  reauthorization_required: "Square authorization needs renewal",
  disconnected: "Disconnected"
};

export default async function IntegrationsPage() {
  const access = await requireWorkspacePage();
  const owner = access.context.membership?.role === "owner";
  const squareEnabled = squareDirectEnabled() && owner;
  const qboEnabled = qboProductionCustomerConnectionsEnabled();
  const [square, qbo, squareEvidence] = await Promise.all([
    squareEnabled ? squareDirectView() : null,
    qboEnabled ? readQuickBooksStatus(access) : null,
    readSquareWorkspaceEvidence(access.supabase, access.workspaceId, await headers())
  ]);
  const squareStatuses = square?.connections.map((connection) =>
    connection.recoveryRequired ? "Connection recovery required"
      : connection.revocationPending ? "Disconnecting" : squareLabels[connection.state]);
  const qboStatuses = qbo?.connections.map((connection) => customerConnectionStatus(
    connection, qbo.freshness.filter((row) => row.connection_id === connection.id)
  ).status);

  return (
    <div className="workspace-page mx-auto max-w-5xl space-y-5">
      <PageHeader eyebrow="Workspace" title="Integrations" description="Connections and data status for this workspace." />
      {squareEnabled || qboEnabled || squareEvidence ? (
        <div className="grid items-stretch gap-4 md:grid-cols-2">
          {squareEnabled ? <ProviderCard name="Square" description="Payments and location connections."
            statuses={!square ? ["Status unavailable"] : squareStatuses?.length ? [...new Set(squareStatuses)] : ["Not connected"]}
            href={squareSettingsPath} action={square?.available && !square.connections.length ? "Connect Square" : "Manage Square"} /> : null}
          {qboEnabled ? <ProviderCard name="QuickBooks Online" description="Accounting connections and stored financial data."
            statuses={!qbo ? ["Status unavailable"] : qboStatuses?.length ? [...new Set(qboStatuses)] : ["Not connected"]}
            href="/app/settings/integrations/quickbooks" action={owner && qbo && !qbo.connections.length ? "Connect QuickBooks" : "Manage QuickBooks"} /> : null}
          {squareEvidence ? <ProviderCard name="Square Sandbox" description="Verified non-economic observations."
            statuses={["Sync health unknown"]} href="/app/integrations/square" action="View Square Sandbox" /> : null}
        </div>
      ) : <p role="status" className="border-y border-line py-4 text-sm text-muted">No integrations are available for your workspace role right now.</p>}
    </div>
  );
}
