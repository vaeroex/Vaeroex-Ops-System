import "server-only";

import { qboProductionCustomerConnectionsEnabled } from "@/lib/integrations/control-plane/qbo-customer-availability";
import type { IntegrationConnectionSummaryRow } from "@/lib/integrations/control-plane/customer-status";
import type { requireWorkspacePage } from "@/lib/workspaces/page-context";

type WorkspaceReader = Pick<Awaited<ReturnType<typeof requireWorkspacePage>>, "supabase" | "workspaceId" | "context">;

export async function withQuickBooksPendingCancellation(
  { supabase, workspaceId, context }: WorkspaceReader,
  connections: readonly IntegrationConnectionSummaryRow[]
) {
  const eligible = new Set<string>();
  if (qboProductionCustomerConnectionsEnabled() && context.membership?.role === "owner" &&
      connections.some((connection) => ["pending_authorization", "error"].includes(connection.status))) {
    const { data, error } = await supabase.rpc("read_qbo_customer_pending_cancellations_v1", {
      p_workspace_id: workspaceId
    });
    if (!error && Array.isArray(data)) {
      for (const row of data) {
        if (row && typeof row.connection_id === "string" && row.can_cancel === true) eligible.add(row.connection_id);
      }
    }
  }
  return connections.map((connection) => ({ ...connection, can_cancel_pending: eligible.has(connection.id) }));
}

export async function readQuickBooksStatus(access: WorkspaceReader, includePendingCancellation = false) {
  if (!qboProductionCustomerConnectionsEnabled()) return null;
  const { supabase, workspaceId } = access;
  const { data: connections, error } = await supabase
    .from("integration_connection_summaries")
    .select("id, provider_key, safe_display_name, status, status_changed_at")
    .eq("workspace_id", workspaceId)
    .eq("provider_key", "quickbooks_online")
    .eq("provider_environment", "production")
    .not("status", "in", '("deleted","disconnected")')
    .order("status_changed_at", { ascending: false });
  if (error || !connections) return null;
  const connectionIds = connections.map((connection) => connection.id);
  const { data: freshness, error: freshnessError } = connectionIds.length
    ? await supabase
        .from("integration_freshness_summaries")
        .select("connection_id, scope_key, status, last_successful_sync_at, calculated_at")
        .eq("workspace_id", workspaceId)
        .in("connection_id", connectionIds)
    : { data: [], error: null };
  if (freshnessError || !freshness) return null;
  return { connections: includePendingCancellation
    ? await withQuickBooksPendingCancellation(access, connections) : connections, freshness };
}
