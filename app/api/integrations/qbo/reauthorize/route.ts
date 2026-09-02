import { createHash, randomBytes, randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import {
  assertQboCustomerRequestOrigin,
  qboProductionOAuthConfiguration,
  readQboReauthorizationRequest
} from "@/lib/integrations/control-plane/qbo-customer-oauth";
import {
  qboCustomerConnectionsUnavailableResponse,
  qboProductionCustomerConnectionsEnabled
} from "@/lib/integrations/control-plane/qbo-customer-availability";
import {
  createQboCustomerReauthorizationState,
  QBO_CUSTOMER_REAUTHORIZATION_STATE_CONTRACT_VERSION
} from "@/lib/integrations/persistence/qbo-production-repository";
import type { ExternalIntegrationsRpcClient } from "@/lib/integrations/persistence/repository";
import {
  QBO_ACCOUNTING_SCOPE,
  createQboAuthorizationUrl
} from "@/lib/integrations/provider-runtime/qbo/oauth";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";

export async function POST(request: Request) {
  if (!qboProductionCustomerConnectionsEnabled()) {
    return qboCustomerConnectionsUnavailableResponse();
  }

  try {
    const configuration = qboProductionOAuthConfiguration();
    assertQboCustomerRequestOrigin(request);
    const input = await readQboReauthorizationRequest(request);
    const access = await requireWorkspaceAccess();
    if (!["owner", "admin", "manager"].includes(access.membership.role)) {
      return NextResponse.json({ ok: false, error: "Connection management is not permitted." }, { status: 403 });
    }
    const { data: connection } = await access.supabase
      .from("integration_connection_summaries")
      .select("id,workspace_id,provider_key,provider_environment,status,state_reason_code,connection_generation,row_version")
      .eq("workspace_id", access.workspaceId)
      .eq("id", input.connectionId)
      .eq("provider_key", "quickbooks_online")
      .eq("provider_environment", "production")
      .eq("status", "reauthorization_required")
      .eq("state_reason_code", "authorization_required")
      .maybeSingle();
    if (!connection) {
      return NextResponse.json({ ok: false, error: "Connection is unavailable." }, { status: 403 });
    }

    const now = new Date();
    const state = `r1_${randomBytes(32).toString("base64url")}`;
    const stateId = randomUUID();
    const stateHash = `sha256:${createHash("sha256").update(state, "utf8").digest("hex")}`;
    const result = await createQboCustomerReauthorizationState(
      {
        contractVersion: QBO_CUSTOMER_REAUTHORIZATION_STATE_CONTRACT_VERSION,
        stateId,
        connectionId: connection.id,
        expectedConnectionGeneration: connection.connection_generation,
        expectedConnectionRowVersion: connection.row_version,
        requestedScopes: [QBO_ACCOUNTING_SCOPE],
        redirectUri: configuration.redirectUri,
        returnIntent: configuration.returnIntent,
        stateHash,
        requestedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 10 * 60 * 1_000).toISOString()
      },
      `qbo_reauthorize_${stateId.replaceAll("-", "")}`,
      access.supabase as unknown as ExternalIntegrationsRpcClient
    );
    if (result.connectionId !== connection.id) {
      throw new Error("qbo_reauthorization_state_binding_mismatch");
    }
    return NextResponse.redirect(
      createQboAuthorizationUrl({
        clientId: configuration.clientId,
        redirectUri: configuration.redirectUri,
        state
      }),
      303
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "QuickBooks reauthorization could not be started." },
      { status: 400, headers: { "cache-control": "no-store" } }
    );
  }
}
