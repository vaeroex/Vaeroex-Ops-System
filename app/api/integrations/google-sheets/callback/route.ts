import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireSheetsManager, sheetsFailure, sheetsRedirect } from "@/lib/integrations/google-sheets/route-helpers";
import { assertSheetsOrigin, encryptSheetsTokens, exchangeSheetsCode, sheetsAdmin, sheetsConfiguration,
  sheetsStateHash, sheetsLifecycle, parseSheetsCredential } from "@/lib/integrations/google-sheets/server";

export async function GET(request: Request) {
  try {
    assertSheetsOrigin(request, true);
    const config = sheetsConfiguration(), url = new URL(request.url);
    const state = z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(url.searchParams.get("state"));
    for (const key of ["state", "code", "error"]) if (url.searchParams.getAll(key).length > 1) throw new Error("google_sheets_callback_invalid");
    if (url.searchParams.has("code") === url.searchParams.has("error")) throw new Error("google_sheets_callback_invalid");
    const code = url.searchParams.has("code") ? z.string().min(8).max(8192).parse(url.searchParams.get("code")) : null;
    const { data: pending, error } = await sheetsAdmin().from("google_sheets_oauth_states")
      .select("workspace_id").eq("state_hash", sheetsStateHash(state)).maybeSingle();
    if (error || !pending) return sheetsRedirect("error", "invalid_state");
    const access = await requireSheetsManager(pending.workspace_id), leaseId = randomUUID();
    const context = parseSheetsCredential(await sheetsLifecycle("consume", access.workspaceId, null,
      { stateHash: sheetsStateHash(state), leaseId, redirectUri: config.redirectUri }, access.user.id, access.sessionId), access.workspaceId);
    if (context.leaseId !== leaseId) throw new Error("google_sheets_callback_invalid");
    if (url.searchParams.has("error")) {
      await sheetsLifecycle("decline", access.workspaceId, context.connectionId, { leaseId }, access.user.id, access.sessionId);
      return sheetsRedirect("error", "consent_denied");
    }
    let tokens;
    try { tokens = await exchangeSheetsCode(code!); }
    catch (failure) {
      // Invalid grant is a known rejection. A network failure can mean an issued
      // credential was lost, so preserve authorization_uncertain for recovery.
      if (failure instanceof Error && failure.message === "google_sheets_authorization_required")
        await sheetsLifecycle("decline", access.workspaceId, context.connectionId, { leaseId }, access.user.id, access.sessionId);
      throw failure;
    }
    const ciphertext = encryptSheetsTokens(access.workspaceId, context.connectionId, tokens, context.generation, 1);
    let receipt: unknown;
    try { receipt = await sheetsLifecycle("complete_oauth", access.workspaceId, context.connectionId,
      { leaseId, ciphertext, accessExpiresAt: tokens.expiresAt }, access.user.id, access.sessionId); }
    catch { receipt = await sheetsLifecycle("credential", access.workspaceId, context.connectionId); }
    const connected = parseSheetsCredential(receipt, access.workspaceId, context.connectionId);
    if (connected.ciphertext !== ciphertext || connected.generation !== context.generation || connected.credentialVersion !== 1)
      throw new Error("google_sheets_credential_storage_failed");
    return sheetsRedirect("result", "connected");
  } catch (error) { return sheetsFailure(400, error); }
}
