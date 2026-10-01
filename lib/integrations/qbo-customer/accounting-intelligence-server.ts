import "server-only";
import { z } from "zod";
import { requireAuth } from "@/lib/security/require-auth";
import { getCurrentWorkspace } from "@/lib/security/get-current-workspace";
import { qboProductionCustomerConnectionsEnabled } from "@/lib/integrations/control-plane/qbo-customer-availability";
import { qboCustomerStoredData } from "@/lib/integrations/qbo-customer/server";
import { buildQboAccountingIntelligence, parseQboAccountingSummary, QBO_ACCOUNTING_INTELLIGENCE_CONNECTION_LIMIT,
  type QboAccountingIntelligence, type QboAccountingSummary } from "./accounting-intelligence";

export type QboAccountingIntelligenceLoad =
  | { state: "hidden" }
  | { state: "unavailable" }
  | { state: "available"; data: QboAccountingIntelligence; connectionsTruncated: boolean };

export async function loadQboAccountingIntelligence(workspaceId: string, asOf: string): Promise<QboAccountingIntelligenceLoad> {
  if (!qboProductionCustomerConnectionsEnabled()) return { state: "hidden" };
  try {
    const { supabase, user } = await requireAuth();
    const access = await getCurrentWorkspace();
    if (access.workspaceId !== workspaceId || access.membership.workspace_id !== workspaceId
      || access.membership.user_id !== user.id || access.membership.role !== "owner" || access.membership.status !== "active") return { state: "hidden" };
    const claims = await supabase.auth.getClaims();
    if (claims.error || claims.data?.claims.sub !== user.id
      || !z.string().uuid().safeParse(claims.data.claims.session_id).success) return { state: "hidden" };
    const stored = await qboCustomerStoredData({}, access.workspaceId);
    if (!stored) return { state: "hidden" };
    const connections = stored.browser.connections;
    if (new Set(connections.map((connection) => connection.connectionId)).size !== connections.length) return { state: "unavailable" };
    const call = supabase.rpc.bind(supabase) as unknown as
      (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
    const summaries: QboAccountingSummary[] = [];
    for (const connection of connections.slice(0, QBO_ACCOUNTING_INTELLIGENCE_CONNECTION_LIMIT)) {
      const result = await call("read_qbo_customer_accounting_summary_v1", { p_connection_id: connection.connectionId });
      if (result.error || result.data === null) return { state: "unavailable" };
      summaries.push(parseQboAccountingSummary(result.data, access.workspaceId, connection.connectionId));
    }
    return { state: "available", connectionsTruncated: connections.length > QBO_ACCOUNTING_INTELLIGENCE_CONNECTION_LIMIT,
      data: buildQboAccountingIntelligence({ workspaceId: access.workspaceId, summaries, asOf }) };
  } catch {
    // No raw RPC errors, source data, or permission fallback totals reach the page.
    return { state: "unavailable" };
  }
}
