import { NextResponse } from "next/server";
import { validSheetsSchedulerSecret } from "@/lib/integrations/google-sheets/server";
import { recoverExpiredSheetsSyncs } from "@/lib/integrations/google-sheets/recovery";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

/** Keep recovery available while new-provider-work activation is disabled.
 * This route never contacts Google or creates a new sync. Its <=15s independent
 * schedule is an operator activation prerequisite, not a changed refresh cron. */
export async function GET(request: Request) {
  const headers = { "cache-control": "no-store" };
  if (!validSheetsSchedulerSecret(request.headers.get("authorization"), process.env.CRON_SECRET))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  try {
    const result = await recoverExpiredSheetsSyncs();
    return NextResponse.json(result, { status: result.remainingExpired ? 503 : 200, headers });
  } catch {
    return NextResponse.json({ error: "Recovery unavailable" }, { status: 503, headers });
  }
}
