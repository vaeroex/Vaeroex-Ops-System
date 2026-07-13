import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { processDueSourceFilePurges, processDueWorkspaceResetPurges } from "@/lib/workspaces/reset-storage";

export const maxDuration = 60;

export async function GET(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase service role is not configured." }, { status: 500 });
  }

  try {
    const [workspaceResets, sourceFiles] = await Promise.all([
      processDueWorkspaceResetPurges(admin, 1),
      processDueSourceFilePurges(admin, 25)
    ]);

    const failures = [
      ...workspaceResets.filter((result) => result.status === "partial"),
      ...sourceFiles.filter((result) => result.status === "failed")
    ].length;

    return NextResponse.json({
      ok: failures === 0,
      workspace_reset_operations: workspaceResets,
      source_file_purges: sourceFiles,
      failures
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Workspace reset purge failed safely." },
      { status: 500 }
    );
  }
}
