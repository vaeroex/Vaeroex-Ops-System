import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { reportingRequestSignal } from "@/lib/integrations/reporting/execution";
import { validReportingSchedulerSecret } from "@/lib/integrations/reporting/scheduler";
import { squareDirectConfig, squareDirectEnabled } from "@/lib/integrations/square-direct/server";
import { squareRecurringScope } from "@/lib/integrations/square-direct/recurring-scope";
import { runDueSquareRefreshes, runSquareRecurring, type SquareRecurringDatabase } from "@/lib/integrations/square-direct/recurring";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const headers = { "cache-control": "no-store" };
  if (!validReportingSchedulerSecret(request.headers.get("authorization"), process.env.CRON_SECRET))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  const scope = squareRecurringScope();
  if (!squareDirectEnabled() || !scope) return NextResponse.json({ enabled: false, attempted: 0 }, { headers });
  try {
    const settings = squareDirectConfig(), db = createSupabaseAdminClient() as unknown as SquareRecurringDatabase | null;
    if (!db) throw new Error("square_recurring_database_unavailable");
    const args = { p_limit: 20, p_allowed_workspaces: scope.workspaceIds, p_application_id: settings.applicationId };
    const recovered = await db.rpc("square_customer_recover_recurring_v1", args).abortSignal(reportingRequestSignal(Date.now() + 10_000));
    if (recovered.error) throw new Error("square_recurring_recovery_unavailable");
    const result = await runDueSquareRefreshes({
      eligible: row => scope.workspaceIds.includes(row.workspace_id),
      due: async (limit, deadlineAt) => {
        const result = await db.rpc("square_customer_due_recurring_v1", { ...args, p_limit: limit }).abortSignal(reportingRequestSignal(deadlineAt));
        if (result.error || !Array.isArray(result.data)) throw new Error("square_recurring_due_unavailable");
        return z.array(z.object({ connection_id: z.string().uuid(), workspace_id: z.string().uuid() }).strict()).max(20).parse(result.data);
      },
      sync: (connection, execution) => runSquareRecurring(connection, execution, { db })
    });
    return NextResponse.json({ enabled: true, recovered: recovered.data, ...result }, { status: result.cleanupFailed ? 503 : 200, headers });
  } catch { return NextResponse.json({ error: "Scheduling unavailable" }, { status: 503, headers }); }
}
