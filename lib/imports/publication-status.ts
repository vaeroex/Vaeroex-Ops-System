import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

type FileImportRow = Database["public"]["Tables"]["file_imports"]["Row"];

/** Status-only lookup, independent of the bounded historical import list. */
export async function loadHeldImportStatus({
  supabase, workspaceId, fileIds
}: {
  supabase: SupabaseClient<Database>;
  workspaceId: string;
  fileIds: string[];
}) {
  const imports: FileImportRow[] = [];
  const unavailableFileIds = new Set<string>();
  const uniqueIds = [...new Set(fileIds)];
  for (let offset = 0; offset < uniqueIds.length; offset += 200) {
    const requested = uniqueIds.slice(offset, offset + 200);
    try {
      const { data, count, error } = await supabase.from("file_imports")
        .select("*", { count: "exact" })
        .eq("workspace_id", workspaceId)
        .in("file_upload_id", requested)
        .in("recovery_status", ["running", "reconciliation_required"]);
      if (error || !Array.isArray(data) || count !== data.length
        || data.some((row) => row.workspace_id !== workspaceId || !requested.includes(row.file_upload_id)
          || !["running", "reconciliation_required"].includes(row.recovery_status))) {
        requested.forEach((id) => unavailableFileIds.add(id));
        continue;
      }
      imports.push(...data);
    } catch {
      requested.forEach((id) => unavailableFileIds.add(id));
    }
  }
  return { imports, unavailableFileIds };
}
