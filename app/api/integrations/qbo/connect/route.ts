import { createHash, randomBytes, randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import {
  assertQboCustomerRequestOrigin,
  qboProductionOAuthConfiguration,
  readQboConnectRequest
} from "@/lib/integrations/control-plane/qbo-customer-oauth";
import {
  qboCustomerConnectionsUnavailableResponse,
  qboProductionCustomerConnectionsEnabled
} from "@/lib/integrations/control-plane/qbo-customer-availability";
import { createIntegrationConnectionIntent } from "@/lib/integrations/persistence/control-plane-repository";
import {
  createQboCustomerOAuthState,
  QBO_CUSTOMER_OAUTH_STATE_CONTRACT_VERSION
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
    const input = await readQboConnectRequest(request);
    const access = await requireWorkspaceAccess();
    if (!['owner', 'admin', 'manager'].includes(access.membership.role)) {
      return NextResponse.json({ ok: false, error: "Connection management is not permitted." }, { status: 403 });
    }
    const { data: entity } = await access.supabase
      .from("business_entities")
      .select("id,status")
      .eq("workspace_id", access.workspaceId)
      .eq("id", input.businessEntityId)
      .eq("status", "active")
      .maybeSingle();
    if (!entity) {
      return NextResponse.json({ ok: false, error: "Business entity is unavailable." }, { status: 403 });
    }

    const rpcClient = access.supabase as unknown as ExternalIntegrationsRpcClient;
    const now = new Date();
    const connectionId = randomUUID();
    const connection = await createIntegrationConnectionIntent(
      {
        id: connectionId,
        workspaceId: access.workspaceId,
        businessEntityId: entity.id,
        providerKey: "quickbooks_online",
        providerEnvironment: "production",
        safeDisplayName: input.displayName,
        requestedScopes: [QBO_ACCOUNTING_SCOPE],
        requestedAt: now.toISOString()
      },
      rpcClient
    );
    const state = `i1_${randomBytes(32).toString("base64url")}`;
    const stateHash = `sha256:${createHash("sha256").update(state, "utf8").digest("hex")}`;
    const stateId = randomUUID();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1_000).toISOString();
    const stateResult = await createQboCustomerOAuthState(
      {
        contractVersion: QBO_CUSTOMER_OAUTH_STATE_CONTRACT_VERSION,
        stateId,
        connectionId: connection.connection.id,
        expectedConnectionGeneration: connection.connection.connectionGeneration,
        expectedConnectionRowVersion: connection.connection.rowVersion,
        requestedScopes: [QBO_ACCOUNTING_SCOPE],
        redirectUri: configuration.redirectUri,
        returnIntent: configuration.returnIntent,
        stateHash,
        requestedAt: now.toISOString(),
        expiresAt
      },
      `qbo_connect_${stateId.replaceAll("-", "")}`,
      rpcClient
    );
    if (stateResult.connectionId !== connection.connection.id) {
      throw new Error("qbo_connect_state_binding_mismatch");
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
      { ok: false, error: "QuickBooks connection could not be started." },
      { status: 400, headers: { "cache-control": "no-store" } }
    );
  }
}
