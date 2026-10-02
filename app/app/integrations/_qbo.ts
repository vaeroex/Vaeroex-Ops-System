import "server-only";

import { qboProductionCustomerConnectionsEnabled } from "@/lib/integrations/control-plane/qbo-customer-availability";
import type { requireWorkspacePage } from "@/lib/workspaces/page-context";

type WorkspaceReader = Pick<Awaited<ReturnType<typeof requireWorkspacePage>>, "supabase" | "workspaceId">;

export async function readQuickBooksStatus({ supabase, workspaceId }: WorkspaceReader) {
  if (!qboProductionCustomerConnectionsEnabled()) return null;
  const { data: connections, error } = await supabase
    .from("integration_connection_summaries")
    .select("id, provider_key, safe_display_name, status, status_changed_at, granted_scopes")
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
  return { connections, freshness };
}
