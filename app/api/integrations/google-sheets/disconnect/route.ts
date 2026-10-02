import { z } from "zod";
import { requireSheetsManager, sheetsFailure, sheetsRedirect } from "@/lib/integrations/google-sheets/route-helpers";
import { assertSheetsOrigin, decryptSheetsTokens, parseSheetsCredential, readSheetsForm, revokeSheetsToken,
  sheetsLifecycle } from "@/lib/integrations/google-sheets/server";

export async function POST(request: Request) {
  try {
    assertSheetsOrigin(request);
    const input = z.object({ connectionId: z.string().uuid(), confirmation: z.literal("disconnect") }).strict().parse(await readSheetsForm(request, 1024));
    const access = await requireSheetsManager(undefined, false);
    const connection = parseSheetsCredential(await sheetsLifecycle("disconnect", access.workspaceId, input.connectionId,
      {}, access.user.id, access.sessionId), access.workspaceId, input.connectionId);
    if (connection.ciphertext) {
      const tokens = decryptSheetsTokens(access.workspaceId, input.connectionId, connection.ciphertext, connection.generation, connection.credentialVersion);
      // If revocation fails, local reads stay fenced and encrypted credentials
      // remain available for the customer's explicit disconnect retry.
      await revokeSheetsToken(tokens.refreshToken);
    }
    await sheetsLifecycle("complete_disconnect", access.workspaceId, input.connectionId,
      { credentialVersion: connection.credentialVersion, generation: connection.generation }, access.user.id, access.sessionId);
    return sheetsRedirect("result", "disconnected");
  } catch (error) { return sheetsFailure(400, error); }
}
