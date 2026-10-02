import { NextResponse } from "next/server";
import { sheetsAdmin, sheetsEnabled, validSheetsSchedulerSecret } from "@/lib/integrations/google-sheets/server";
import { runSheetsSync } from "@/lib/integrations/google-sheets/sync";
import { runDueSheetsRefreshes } from "@/lib/integrations/google-sheets/scheduler";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** SQL independently claims each connection; simultaneous manual/timer runs
 * cannot duplicate it. The dispatcher stops starting work after four minutes. */
export async function GET(request: Request) {
  const headers = { "cache-control": "no-store" };
  if (!validSheetsSchedulerSecret(request.headers.get("authorization"), process.env.CRON_SECRET))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  if (!sheetsEnabled()) return NextResponse.json({ enabled: false, attempted: 0 }, { headers });
  try {
    const result = await runDueSheetsRefreshes({
      due: async (tickAt, limit) => {
        const { data, error } = await sheetsAdmin().from("google_sheets_connections")
          .select("id,workspace_id").eq("status", "connected").eq("automatic_refresh_enabled", true)
          .not("active_approval_id", "is", null).lte("next_sync_at", tickAt)
          .order("next_sync_at").limit(limit);
        if (error) throw new Error("google_sheets_scheduling_unavailable");
        return data ?? [];
      },
      sync: connection => runSheetsSync({ workspaceId: connection.workspace_id, connectionId: connection.id,
        actorId: null, sessionId: null, trigger: "scheduled" }),
      backoff: async (connection, tickAt) => {
        // A revoked approval/expired subscription can reject a claim before a
        // run exists. Back off that unchanged due slot so it cannot starve others.
        const { error } = await sheetsAdmin().from("google_sheets_connections").update({
          next_sync_at: new Date(Date.now() + 3_600_000).toISOString(),
          last_error_code: "automatic_refresh_unavailable"
        }).eq("workspace_id", connection.workspace_id).eq("id", connection.id)
          .eq("status", "connected").eq("automatic_refresh_enabled", true).lte("next_sync_at", tickAt);
        if (error) throw new Error("google_sheets_backoff_unavailable");
      }
    });
    return NextResponse.json({ enabled: true, ...result }, { headers });
  } catch {
    return NextResponse.json({ error: "Scheduling unavailable" }, { status: 503, headers });
  }
}
