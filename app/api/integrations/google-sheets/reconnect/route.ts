import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSheetsManager, sheetsFailure } from "@/lib/integrations/google-sheets/route-helpers";
import { assertSheetsOrigin, readSheetsForm, sheetsAuthorizationUrl, sheetsConfiguration,
  sheetsLifecycle, sheetsStateHash } from "@/lib/integrations/google-sheets/server";

export async function POST(request: Request) {
  if (request.headers.get("accept") !== "application/json") return NextResponse.json(
    { ok: false, error: "Open Google Sheets from its connection page." }, { status: 406, headers: { "cache-control": "no-store" } });
  try {
    assertSheetsOrigin(request);
    const input = z.object({ connectionId: z.string().uuid() }).strict().parse(await readSheetsForm(request, 1024));
    const access = await requireSheetsManager(), state = randomBytes(32).toString("base64url");
    await sheetsLifecycle("reconnect", access.workspaceId, input.connectionId, {
      stateHash: sheetsStateHash(state), redirectUri: sheetsConfiguration().redirectUri
    }, access.user.id, access.sessionId);
    return NextResponse.json({ ok: true, authorizationUrl: sheetsAuthorizationUrl(state).toString() },
      { headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  } catch { return sheetsFailure(409); }
}
