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
import { beginQboCustomerConnection } from "@/lib/integrations/persistence/qbo-pending-connection-repository";
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
  if (request.headers.get("accept") !== "application/json") {
    return NextResponse.json({ ok: false, error: "Open QuickBooks from its connection page." },
      { status: 406, headers: { "cache-control": "no-store" } });
  }

  try {
    const configuration = qboProductionOAuthConfiguration();
    assertQboCustomerRequestOrigin(request);
    const input = await readQboConnectRequest(request);
    const access = await requireWorkspaceAccess();
    if (access.membership.role !== "owner") {
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
    const state = `i1_${randomBytes(32).toString("base64url")}`;
    const stateHash = `sha256:${createHash("sha256").update(state, "utf8").digest("hex")}`;
    const stateId = randomUUID();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1_000).toISOString();
    const result = await beginQboCustomerConnection({
      connection: {
        id: connectionId,
        workspaceId: access.workspaceId,
        businessEntityId: entity.id,
        providerKey: "quickbooks_online",
        providerEnvironment: "production",
        safeDisplayName: input.displayName,
        requestedScopes: [QBO_ACCOUNTING_SCOPE],
        requestedAt: now.toISOString()
      },
      oauthState: {
        stateId,
        redirectUri: configuration.redirectUri,
        returnIntent: configuration.returnIntent,
        stateHash,
        requestedAt: now.toISOString(),
        expiresAt
      },
      requestId: `qbo_connect_${stateId.replaceAll("-", "")}`
    }, rpcClient);
    if (result.disposition === "pending") {
      return NextResponse.json({ ok: false, error: "Cancel the existing pending attempt before trying again." },
        { status: 409, headers: { "cache-control": "no-store" } });
    }
    return NextResponse.json(
      { ok: true, authorizationUrl: createQboAuthorizationUrl({
        clientId: configuration.clientId,
        redirectUri: configuration.redirectUri,
        state
      }) },
      { headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } }
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "QuickBooks connection could not be started." },
      { status: 400, headers: { "cache-control": "no-store" } }
    );
  }
}
