import { z } from "zod";
import { requireSheetsManager, sheetsFailure, sheetsRedirect } from "@/lib/integrations/google-sheets/route-helpers";
import { assertSheetsOrigin, readSheetsForm, sheetsLifecycle } from "@/lib/integrations/google-sheets/server";

/** Explicit user attestation only; no claim of a verified Google revocation. */
export async function POST(request: Request) {
  try {
    assertSheetsOrigin(request);
    const input = z.object({ connectionId: z.string().uuid(), confirmation: z.literal("access_removed") }).strict().parse(await readSheetsForm(request, 1024));
    const access = await requireSheetsManager(undefined, false);
    await sheetsLifecycle("recover_oauth", access.workspaceId, input.connectionId,
      { confirmation: input.confirmation }, access.user.id, access.sessionId);
    return sheetsRedirect("result", "recovery_recorded");
  } catch (error) { return sheetsFailure(400, error); }
}
