import "server-only";

import { z } from "zod";

import {
  normalizeProviderOAuthReturnPath,
  validateProviderOAuthCallbackUri
} from "@/lib/integrations/credentials/oauth-policy";
import { QBO_PRODUCTION_OAUTH_POLICY } from "@/lib/integrations/provider-runtime/qbo/oauth-policy";

const ConnectRequestSchema = z
  .object({
    businessEntityId: z.string().uuid(),
    displayName: z.string().trim().min(1).max(120)
  })
  .strict();

const ReauthorizationRequestSchema = z
  .object({ connectionId: z.string().uuid() })
  .strict();

const DisconnectRequestSchema = z
  .object({
    connectionId: z.string().uuid(),
    confirmation: z.literal("disconnect")
  })
  .strict();

export function qboCustomerApplicationOrigin() {
  const value = new URL(process.env.QBO_APPLICATION_ORIGIN ?? "");
  if (
    value.protocol !== "https:" ||
    value.username ||
    value.password ||
    value.pathname !== "/" ||
    value.search ||
    value.hash ||
    /(?:sandbox|phase8b|p8b|sslip\.io)/i.test(value.toString())
  ) {
    throw new Error("qbo_production_application_origin_invalid");
  }
  return value.origin;
}

export function assertQboCustomerRequestOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || new URL(origin).origin !== qboCustomerApplicationOrigin()) {
    throw new Error("qbo_customer_request_origin_denied");
  }
}

async function boundedRequestRecord(request: Request, maximumBytes: number) {
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > maximumBytes) {
    throw new Error("qbo_customer_request_invalid");
  }
  const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const contentType = request.headers.get("content-type")?.split(";", 1)[0];
  if (contentType === "application/json") {
    return z.record(z.unknown()).parse(JSON.parse(body));
  }
  if (contentType === "application/x-www-form-urlencoded") {
    return Object.fromEntries(new URLSearchParams(body));
  }
  throw new Error("qbo_customer_request_content_type_invalid");
}

export async function readQboConnectRequest(request: Request) {
  return ConnectRequestSchema.parse(await boundedRequestRecord(request, 4_096));
}

export async function readQboReauthorizationRequest(request: Request) {
  return ReauthorizationRequestSchema.parse(
    await boundedRequestRecord(request, 1_024)
  );
}

export async function readQboDisconnectRequest(request: Request) {
  return DisconnectRequestSchema.parse(
    await boundedRequestRecord(request, 1_024)
  );
}

export function qboProductionOAuthConfiguration() {
  const clientId = process.env.QBO_PRODUCTION_CLIENT_ID;
  const redirectUri = process.env.QBO_PRODUCTION_CALLBACK_URI;
  const returnIntent = process.env.QBO_PRODUCTION_RETURN_INTENT;
  if (!clientId || !redirectUri || !returnIntent) {
    throw new Error("qbo_production_oauth_configuration_missing");
  }
  const callback = new URL(
    validateProviderOAuthCallbackUri(QBO_PRODUCTION_OAUTH_POLICY, redirectUri)
  );
  const normalizedReturnIntent = normalizeProviderOAuthReturnPath(
    QBO_PRODUCTION_OAUTH_POLICY,
    returnIntent
  );
  const callbackOrigin = callback.origin;
  if (
    callback.protocol !== "https:" ||
    callback.username ||
    callback.password ||
    callback.search ||
    callback.hash ||
    /(?:sandbox|phase8b|p8b|sslip\.io)/i.test(callback.toString()) ||
    callbackOrigin === "https://appcenter.intuit.com" ||
    /(?:sandbox|phase8b|p8b)/i.test(normalizedReturnIntent)
  ) {
    throw new Error("qbo_production_oauth_configuration_invalid");
  }
  return {
    clientId,
    redirectUri: callback.toString(),
    returnIntent: normalizedReturnIntent
  } as const;
}
