import { z } from "zod";
import { assertMapping } from "@/lib/integrations/google-sheets/contracts";
import { requireSheetsManager, sheetsConnection, sheetsFailure, sheetsRedirect } from "@/lib/integrations/google-sheets/route-helpers";
import { assertSheetsOrigin, readSheetsForm, sheetsAdmin } from "@/lib/integrations/google-sheets/server";

export async function POST(request: Request) {
  try {
    assertSheetsOrigin(request);
    const input = z.object({ connectionId: z.string().uuid(), fieldMapping: z.string().max(12_000),
      confirmation: z.literal("approve"), automaticRefresh: z.enum(["true", "false"]) }).strict().parse(await readSheetsForm(request));
    const access = await requireSheetsManager(), connection = await sheetsConnection(access.workspaceId, input.connectionId);
    if (connection.status !== "connected" || connection.sheet_id === null) return sheetsFailure(403);
    const mapping = assertMapping(z.array(z.string()).max(100).parse(connection.headers), JSON.parse(input.fieldMapping));
    const admin = sheetsAdmin(), rpc = admin.rpc.bind(admin) as unknown as (name: string, args: Record<string, unknown>) =>
      Promise<{ data: unknown; error: unknown }>;
    const result = await rpc("approve_google_sheets_mapping_v1", { p_workspace_id: access.workspaceId,
      p_connection_id: input.connectionId, p_actor_id: access.user.id, p_session_id: access.sessionId,
      p_mapping: mapping, p_automatic_enabled: input.automaticRefresh === "true" });
    if (result.error || !result.data) throw new Error("google_sheets_mapping_save_failed");
    return sheetsRedirect("result", "mapping_saved");
  } catch (error) { return sheetsFailure(400, error); }
}
