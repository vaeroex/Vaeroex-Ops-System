import { NextResponse } from "next/server";
import { sheetsAdmin, sheetsEnabled, validSheetsSchedulerSecret } from "@/lib/integrations/google-sheets/server";
import { runSheetsSync } from "@/lib/integrations/google-sheets/sync";
import { runDueSheetsRefreshes } from "@/lib/integrations/google-sheets/scheduler";
import { withSheetsRequest } from "@/lib/integrations/google-sheets/execution";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** SQL independently claims each connection; simultaneous manual/timer runs
 * cannot duplicate it. Work aborts at four minutes, leaving time for cleanup. */
export async function GET(request: Request) {
  const headers = { "cache-control": "no-store" };
  if (!validSheetsSchedulerSecret(request.headers.get("authorization"), process.env.CRON_SECRET))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  if (!sheetsEnabled()) return NextResponse.json({ enabled: false, attempted: 0 }, { headers });
  try {
    const result = await runDueSheetsRefreshes({
      due: async (tickAt, limit, deadlineAt, excludedConnectionIds) => {
        const { data, error } = await withSheetsRequest(deadlineAt, 10_000, signal => {
          let query = sheetsAdmin().from("google_sheets_connections")
            .select("id,workspace_id").eq("status", "connected").eq("automatic_refresh_enabled", true)
            .not("active_approval_id", "is", null).lte("next_sync_at", tickAt);
          // IDs come from this tick's database results; the bound is 50. Exclude
          // attempted rows even when their backoff write failed, so later tenants
          // can progress without increasing provider concurrency or retrying here.
          if (excludedConnectionIds.length) query = query.not("id", "in", `(${excludedConnectionIds.join(",")})`);
          return query.order("next_sync_at").order("id").limit(limit).abortSignal(signal);
        });
        if (error) throw new Error("google_sheets_scheduling_unavailable");
        return data ?? [];
      },
      sync: (connection, execution) => runSheetsSync({ workspaceId: connection.workspace_id, connectionId: connection.id,
        actorId: null, sessionId: null, trigger: "scheduled", execution }),
      backoff: async (connection, tickAt, deadlineAt) => {
        // A revoked approval/expired subscription can reject a claim before a
        // run exists. Back off that unchanged due slot so it cannot starve others.
        const { error } = await withSheetsRequest(deadlineAt, 10_000, signal => sheetsAdmin().from("google_sheets_connections").update({
          next_sync_at: new Date(Date.now() + 3_600_000).toISOString(),
          last_error_code: "automatic_refresh_unavailable"
        }).eq("workspace_id", connection.workspace_id).eq("id", connection.id)
          .eq("status", "connected").eq("automatic_refresh_enabled", true).lte("next_sync_at", tickAt).abortSignal(signal));
        if (error) throw new Error("google_sheets_backoff_unavailable");
      }
    });
    return NextResponse.json({ enabled: true, ...result }, { headers });
  } catch {
    return NextResponse.json({ error: "Scheduling unavailable" }, { status: 503, headers });
  }
}
