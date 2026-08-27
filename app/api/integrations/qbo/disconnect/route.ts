import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import {
  assertQboCustomerRequestOrigin,
  qboCustomerApplicationOrigin,
  readQboDisconnectRequest
} from "@/lib/integrations/control-plane/qbo-customer-oauth";
import { QBO_CUSTOMER_DISCONNECT_PATH } from "@/lib/integrations/control-plane/qbo-customer-routes";
import { requestIntegrationDisconnect } from "@/lib/integrations/persistence/control-plane-repository";
import type { ExternalIntegrationsRpcClient } from "@/lib/integrations/persistence/repository";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";

const managementRoles = new Set(["owner", "admin", "manager"]);
const disconnectableStatuses = new Set([
  "authorized_unmapped",
  "initializing",
  "active",
  "degraded",
  "reauthorization_required"
]);

function disconnectRedirect(kind: "result" | "error", code: string) {
  const target = new URL(
    QBO_CUSTOMER_DISCONNECT_PATH,
    qboCustomerApplicationOrigin()
  );
  target.searchParams.set(kind, code);
  const response = NextResponse.redirect(target, 303);
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function POST(request: Request) {
  const access = await requireWorkspaceAccess();

  try {
    assertQboCustomerRequestOrigin(request);
    const input = await readQboDisconnectRequest(request);
    if (!managementRoles.has(access.membership.role)) {
      return disconnectRedirect("error", "not_permitted");
    }

    const { data: connection } = await access.supabase
      .from("integration_connection_summaries")
      .select(
        "id,business_entity_id,provider_key,provider_environment,status,row_version"
      )
      .eq("workspace_id", access.workspaceId)
      .eq("id", input.connectionId)
      .eq("provider_key", "quickbooks_online")
      .eq("provider_environment", "production")
      .maybeSingle();

    if (!connection) {
      return disconnectRedirect("error", "unavailable");
    }
    if (connection.status === "disconnecting") {
      return disconnectRedirect("result", "in_progress");
    }
    if (connection.status === "disconnected") {
      return disconnectRedirect("result", "disconnected");
    }
    if (!disconnectableStatuses.has(connection.status)) {
      return disconnectRedirect("error", "unavailable");
    }

    const result = await requestIntegrationDisconnect(
      {
        connectionId: connection.id,
        expectedRowVersion: connection.row_version,
        requestId: `qbo_customer_disconnect_${randomUUID().replaceAll("-", "")}`
      },
      access.supabase as unknown as ExternalIntegrationsRpcClient
    );
    if (
      result.connection.id !== connection.id ||
      result.connection.status !== "disconnecting"
    ) {
      throw new Error("qbo_customer_disconnect_result_mismatch");
    }
    return disconnectRedirect("result", "requested");
  } catch {
    return disconnectRedirect("error", "failed");
  }
}
