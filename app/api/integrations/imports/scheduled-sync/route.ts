import { NextResponse } from "next/server";
import { reportingRequestSignal } from "@/lib/integrations/reporting/execution";
import { validReportingSchedulerSecret } from "@/lib/integrations/reporting/scheduler";
import { importRefreshScope } from "@/lib/integrations/import-refresh/scope";
import { importAdmin, importProviderEnabled, runImportRefresh } from "@/lib/integrations/import-refresh/execution";
import { runDueImportRefreshes } from "@/lib/integrations/import-refresh/scheduler";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const headers = { "cache-control": "no-store" };
  if (!validReportingSchedulerSecret(request.headers.get("authorization"), process.env.CRON_SECRET))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  const scope = importRefreshScope();
  if (!scope) return NextResponse.json({ enabled: false, attempted: 0 }, { headers });
  try {
    const providers = scope.providers.filter(importProviderEnabled);
    if (!providers.length) return NextResponse.json({ enabled: true, attempted: 0 }, { headers });
    const db = importAdmin(providers[0]);
    const args = { p_limit: 20, p_allowed_workspaces: scope.workspaceIds, p_allowed_providers: providers };
    const recovered = await db.rpc("recover_import_refreshes", args).abortSignal(reportingRequestSignal(Date.now() + 10_000));
    if (recovered.error) throw new Error("import_recovery_unavailable");
    const result = await runDueImportRefreshes({
      eligible: row => scope.workspaceIds.includes(row.workspace_id) && providers.includes(row.provider),
      due: async (limit, deadlineAt) => {
        const result = await db.rpc("list_due_import_refreshes", { ...args, p_limit: limit }).abortSignal(reportingRequestSignal(deadlineAt));
        if (result.error || !Array.isArray(result.data)) throw new Error("import_due_unavailable");
        return result.data;
      },
      sync: (row, execution) => runImportRefresh({ provider: row.provider, workspaceId: row.workspace_id,
        connectionId: row.id, trigger: "scheduled", execution, db })
    });
    return NextResponse.json({ enabled: true, recovered: recovered.data, ...result }, { status: result.cleanupFailed ? 503 : 200, headers });
  } catch { return NextResponse.json({ error: "Scheduling unavailable" }, { status: 503, headers }); }
}
