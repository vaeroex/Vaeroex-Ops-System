import { NextResponse } from "next/server";
import { admin, available } from "@/lib/integrations/reporting/security";
import { reportingRequestSignal } from "@/lib/integrations/reporting/execution";
import { reportingRefreshScope, runDueReportingRefreshes, runScheduledReportingRefresh, validReportingSchedulerSecret } from "@/lib/integrations/reporting/scheduler";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const headers = { "cache-control": "no-store" };
  if (!validReportingSchedulerSecret(request.headers.get("authorization"), process.env.CRON_SECRET))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  const scope = reportingRefreshScope();
  if (!scope) return NextResponse.json({ enabled: false, attempted: 0 }, { headers });
  try {
    // Exclude disabled/unconfigured providers before SQL applies its bounded
    // page; otherwise their oldest due rows could repeatedly crowd out work.
    const configuredProviders = scope.providers.filter(provider => available(provider));
    if (!configuredProviders.length) return NextResponse.json({ enabled: true, attempted: 0 }, { headers });
    const db = admin();
    const scopeArgs = { p_limit: 20, p_allowed_workspaces: scope.workspaceIds, p_allowed_providers: configuredProviders };
    // Expired attempts retain prior evidence and back off. Recovery is also
    // bounded and scoped; it cannot reactivate a revoked connection.
    const recovered = await db.rpc("recover_reporting_recurring", scopeArgs).abortSignal(reportingRequestSignal(Date.now() + 10_000));
    if (recovered.error) throw new Error("reporting_recovery_unavailable");
    const result = await runDueReportingRefreshes({
      eligible: connection => scope.workspaceIds.includes(connection.workspace_id) && configuredProviders.includes(connection.provider),
      due: async (limit, deadlineAt) => {
        const { data, error } = await db.rpc("list_due_reporting_refreshes", { ...scopeArgs, p_limit: limit })
          .abortSignal(reportingRequestSignal(deadlineAt));
        if (error || !Array.isArray(data)) throw new Error("reporting_due_unavailable");
        return data;
      },
      sync: (connection, execution) => runScheduledReportingRefresh(connection, execution, db)
    });
    return NextResponse.json({ enabled: true, recovered: recovered.data, ...result }, { status: result.cleanupFailed ? 503 : 200, headers });
  } catch {
    return NextResponse.json({ error: "Scheduling unavailable" }, { status: 503, headers });
  }
}
