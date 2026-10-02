import "server-only";
import { z } from "zod";
import { requireAuth } from "@/lib/security/require-auth";
import { getCurrentWorkspace } from "@/lib/security/get-current-workspace";
import { qboProductionCustomerConnectionsEnabled } from "@/lib/integrations/control-plane/qbo-customer-availability";
import { integrationResultVisibility, type IntegrationResultVisibility } from "@/lib/integrations/control-plane/result-visibility";
import { buildQboAccountingIntelligence, parseQboAccountingSummary, QBO_ACCOUNTING_INTELLIGENCE_CONNECTION_LIMIT,
  type QboAccountingIntelligence, type QboAccountingSummary } from "./accounting-intelligence";

export type QboAccountingIntelligenceLoad =
  | { state: "hidden" }
  | { state: "unavailable" }
  | { state: "available"; data: QboAccountingIntelligence; connectionsTruncated: boolean;
      connections: { connectionId: string; label: string; visibility: IntegrationResultVisibility }[] };

export async function loadQboAccountingIntelligence(workspaceId: string, asOf: string): Promise<QboAccountingIntelligenceLoad> {
  if (!qboProductionCustomerConnectionsEnabled()) return { state: "hidden" };
  let hasEstablishedConnection = false;
  try {
    const { supabase, user } = await requireAuth();
    const access = await getCurrentWorkspace();
    if (access.workspaceId !== workspaceId || access.membership.workspace_id !== workspaceId
      || access.membership.user_id !== user.id || access.membership.role !== "owner" || access.membership.status !== "active") return { state: "hidden" };
    const claims = await supabase.auth.getClaims();
    if (claims.error || claims.data?.claims.sub !== user.id
      || !z.string().uuid().safeParse(claims.data.claims.session_id).success) return { state: "hidden" };
    // Canonical Production completion grants this scope; same-row
    // reauthorization, revocation and disconnect retain it. Filter in SQL
    // before bounding results, so retained attempts cannot hide real companies.
    const authority = await supabase.from("integration_connection_summaries")
      .select("id, safe_display_name, status, granted_scopes")
      .eq("workspace_id", workspaceId).eq("provider_key", "quickbooks_online")
      .eq("provider_environment", "production")
      .contains("granted_scopes", ["com.intuit.quickbooks.accounting"])
      .neq("status", "deleted").neq("status", "deleting")
      .order("updated_at", { ascending: false }).order("id", { ascending: true })
      .limit(QBO_ACCOUNTING_INTELLIGENCE_CONNECTION_LIMIT + 1);
    if (authority.error || !authority.data) throw new Error("visibility_unavailable");
    if (!authority.data.length) return { state: "hidden" };
    const connectionIds = authority.data.map((connection) => connection.id);
    if (new Set(connectionIds).size !== connectionIds.length) throw new Error("invalid_connection_list");
    hasEstablishedConnection = true;
    const freshness = await supabase.from("integration_freshness_summaries")
      .select("connection_id, status, last_successful_sync_at")
      .eq("workspace_id", workspaceId).eq("provider_key", "quickbooks_online").in("connection_id", connectionIds);
    if (freshness.error || !freshness.data) throw new Error("visibility_unavailable");
    const call = supabase.rpc.bind(supabase) as unknown as
      (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
    const connections: Extract<QboAccountingIntelligenceLoad, { state: "available" }>["connections"] = [];
    for (const row of authority.data) {
      const streams = freshness.data.filter((stream) => stream.connection_id === row.id);
      const lastSuccessfulSyncAt = streams.map((stream) => stream.last_successful_sync_at)
        .filter((time): time is string => time !== null).sort().at(-1) ?? null;
      const successfulAuthorization = row.granted_scopes.includes("com.intuit.quickbooks.accounting");
      const visibility = integrationResultVisibility({ successfulAuthorization, hasImportedData: false, lastSuccessfulSyncAt,
        connectionState: row.status === "disconnected" || row.status === "disconnecting" ? "disconnected"
          : row.status === "reauthorization_required" ? "reauthorization_required"
            : row.status === "pending_authorization" || row.status === "authorized_unmapped" ? "setup"
              : row.status === "error" || streams.some((stream) => stream.status === "sync_error") ? "sync_error" : "connected",
        freshness: streams.length && streams.every((stream) => stream.status === "current") ? "current"
          : streams.some((stream) => ["stale", "aging"].includes(stream.status)) ? "stale" : "unknown" });
      if (visibility.visible) hasEstablishedConnection = true;
      if (visibility.visible) connections.push({ connectionId: row.id, label: row.safe_display_name, visibility });
    }
    if (!connections.length) return { state: "hidden" };
    hasEstablishedConnection = true;
    const summaries: QboAccountingSummary[] = [];
    for (const connection of connections.slice(0, QBO_ACCOUNTING_INTELLIGENCE_CONNECTION_LIMIT)) {
      const result = await call("read_qbo_customer_accounting_summary_v1", { p_connection_id: connection.connectionId });
      if (result.error || result.data === null) return { state: "unavailable" };
      summaries.push(parseQboAccountingSummary(result.data, access.workspaceId, connection.connectionId));
    }
    return { state: "available", connectionsTruncated: connections.length > QBO_ACCOUNTING_INTELLIGENCE_CONNECTION_LIMIT,
      connections: connections.slice(0, QBO_ACCOUNTING_INTELLIGENCE_CONNECTION_LIMIT),
      data: buildQboAccountingIntelligence({ workspaceId: access.workspaceId, summaries, asOf }) };
  } catch {
    // No raw RPC errors, source data, or permission fallback totals reach the page.
    return { state: hasEstablishedConnection ? "unavailable" : "hidden" };
  }
}
