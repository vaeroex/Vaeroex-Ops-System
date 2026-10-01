import "server-only";
import { z } from "zod";
import { requireAuth } from "@/lib/security/require-auth";
import { getCurrentWorkspace } from "@/lib/security/get-current-workspace";
import { qboProductionCustomerConnectionsEnabled } from "@/lib/integrations/control-plane/qbo-customer-availability";
import { parseQboBrowser, parseQboBrowseQuery } from "./contracts";

export class QboCustomerBrowseError extends Error {
  constructor(readonly reason: "denied" | "query" | "unavailable") { super(`qbo_customer_browse_${reason}`); }
}

export async function qboCustomerStoredData(params: Record<string, string | string[] | undefined>, expectedWorkspaceId?: string) {
  if (!qboProductionCustomerConnectionsEnabled()) return null;
  let query;
  try { query = parseQboBrowseQuery(params); } catch { throw new QboCustomerBrowseError("query"); }
  const { supabase, user } = await requireAuth();
  const access = await getCurrentWorkspace();
  if (expectedWorkspaceId !== undefined && access.workspaceId !== expectedWorkspaceId)
    throw new QboCustomerBrowseError("denied");
  if (access.membership.role !== "owner" || access.membership.user_id !== user.id ||
    access.membership.status !== "active" || access.membership.workspace_id !== access.workspaceId)
    throw new QboCustomerBrowseError("denied");
  const claims = await supabase.auth.getClaims();
  if (claims.error || claims.data?.claims.sub !== user.id ||
    !z.string().uuid().safeParse(claims.data.claims.session_id).success)
    throw new QboCustomerBrowseError("denied");

  // Use the signed-in user's JWT, not service-role authority. SQL independently
  // checks that JWT's owner, live session, workspace and connection/entity scope.
  const call = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) =>
    Promise<{ data: unknown; error: unknown }>;
  try {
    const result = await call("qbo_customer_source_browse_v1", { p_workspace_id: access.workspaceId,
      p_connection_id: query.connectionId, p_after_id: query.after, p_source_id: query.sourceId, p_kind: query.kind });
    if (result.error || result.data === null) throw new QboCustomerBrowseError("unavailable");
    return { browser: parseQboBrowser(result.data), query };
  } catch { throw new QboCustomerBrowseError("unavailable"); }
}
