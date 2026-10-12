import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { storageRpc } from "@/lib/storage-capacity/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const item = z.object({ workspace_id: z.string().uuid(), id: z.string().uuid(), storage_path: z.string() });
const batchSchema = z.object({ files: z.array(item).max(100), uploads: z.array(item).max(100) });
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const expected = Buffer.from(`Bearer ${secret || ""}`);
  const supplied = Buffer.from(request.headers.get("authorization") || "");
  if (!secret || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const admin = createSupabaseAdminClient();
  if (!admin) return Response.json({ error: "Storage maintenance unavailable" }, { status: 503, headers });
  try {
    const batch = batchSchema.parse(await storageRpc(admin, "workspace_storage_cleanup_batch_v1", { p_limit: 100 }));
    let completed = 0;
    let failed = 0;
    const deadline = Date.now() + 240_000;
    for (const entry of [...batch.files.map(file => ({ ...file, file: true })), ...batch.uploads.map(upload => ({ ...upload, file: false }))]) {
      if (Date.now() > deadline) break;
      if (!entry.storage_path.startsWith(`${entry.workspace_id}/`)) { failed++; continue; }
      // Durable database authorization precedes object deletion. The Storage
      // API removes both backing bytes and metadata; retrying is safe.
      const { error } = await admin.storage.from("workspace-files").remove([entry.storage_path]);
      if (error) { failed++; continue; }
      if (entry.file && await storageRpc(admin, "finalize_workspace_file_purge_v1", { p_workspace_id: entry.workspace_id, p_file_id: entry.id }) !== true) { failed++; continue; }
      completed++;
    }
    return Response.json({ attempted: batch.files.length + batch.uploads.length, completed, failed }, { status: failed ? 503 : 200, headers });
  } catch {
    return Response.json({ error: "Storage maintenance could not finish; pending deletions will be retried." }, { status: 503, headers });
  }
}
