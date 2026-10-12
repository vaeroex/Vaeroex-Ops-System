import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";

type FileRow = Database["public"]["Tables"]["file_uploads"]["Row"];
type RunRow = Database["public"]["Tables"]["ai_agent_runs"]["Row"];
const PAGE_SIZE = 500;
// Above the qualified 5,500 retained-file allowance; fail visibly rather than truncate.
const BROWSE_SAFETY_LIMIT = 10_000;
const FILE_SUMMARY_COLUMNS = "id,workspace_id,folder_id,original_name,display_name,file_extension,mime_type,file_size_bytes,storage_bucket,storage_path,import_type,import_status,imported_rows,analysis_summary,processing_status,processing_error,processed_at,index_status,indexed_at,indexed_chunk_count,index_error,created_by,created_at,updated_at,archived_at,deleted_at,analysis_review_status:metadata_json->analysis_review_status,latest_analysis_status:metadata_json->latest_analysis_status,latest_analysis_at:metadata_json->latest_analysis_at,latest_analysis_failure:metadata_json->latest_analysis_failure,latest_analysis_error:metadata_json->latest_analysis_error";

/** An abandoned active run cannot override a later persisted analysis result. */
export function currentSourceRuns(files: FileRow[], runs: RunRow[]) {
  const filesById = new Map(files.map(file => [file.id, file]));
  return runs.filter(run => {
    const input = run.input_json as { extra_inputs?: { file?: { id?: string } } } | null;
    const file = filesById.get(input?.extra_inputs?.file?.id || "");
    if (!file) return false;
    const metadata = file.metadata_json as { latest_analysis_at?: string } | null;
    const resultAt = Date.parse(metadata?.latest_analysis_at || "");
    return !Number.isFinite(resultAt) || Date.parse(run.created_at) > resultAt;
  });
}

/** Keyset paging avoids PostgREST's 1,000-row ceiling and skips deleted history.
 * Extracted text, full analysis output, and analysis prompts load only on the detail route.
 */
export async function loadSourceFiles(supabase: SupabaseClient<Database>, workspaceId: string, detailFileId?: string) {
  if (detailFileId) {
    const result = await supabase.from("file_uploads").select("*").eq("workspace_id", workspaceId)
      .eq("id", detailFileId).is("deleted_at", null).maybeSingle();
    return { data: result.data ? [result.data] : [], error: result.error };
  }
  const files: FileRow[] = [];
  let cursor: string | null = null;
  while (files.length <= BROWSE_SAFETY_LIMIT) {
    let query = supabase.from("file_uploads").select(FILE_SUMMARY_COLUMNS).eq("workspace_id", workspaceId)
      .is("deleted_at", null).order("id", { ascending: true }).limit(PAGE_SIZE);
    if (cursor) query = query.gt("id", cursor);
    const result = await query;
    if (result.error) return { data: [], error: result.error };
    const rows = (result.data || []) as unknown as Array<Omit<FileRow, "metadata_json" | "analysis_prompt"> & Record<string, Json>>;
    for (const row of rows) {
      const { analysis_review_status, latest_analysis_status, latest_analysis_at, latest_analysis_failure, latest_analysis_error, ...file } = row;
      files.push({ ...file, analysis_prompt: null, metadata_json: { analysis_review_status, latest_analysis_status, latest_analysis_at, latest_analysis_failure, latest_analysis_error } } as FileRow);
    }
    if (files.length > BROWSE_SAFETY_LIMIT) break;
    if (rows.length < PAGE_SIZE) return { data: files, error: null };
    const nextCursor = rows.at(-1)?.id;
    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  }
  return { data: [], error: { message: "This workspace needs a separately qualified source browser. Contact support; open a source directly to access an existing file." } };
}

/** The detail history is scoped before its limit, so other files cannot hide it. */
export async function loadSourceRuns(supabase: SupabaseClient<Database>, workspaceId: string, detailFileId?: string) {
  if (detailFileId) return supabase.from("ai_agent_runs").select("*").eq("workspace_id", workspaceId)
    .eq("agent_type", "file_analysis").is("deleted_at", null).is("archived_at", null)
    .eq("input_json->extra_inputs->file->>id", detailFileId).order("created_at", { ascending: false }).limit(300);
  // List status needs only in-flight runs; completed/failed results are retained on the file.
  const runs: RunRow[] = [];
  let cursor: string | null = null;
  while (runs.length <= BROWSE_SAFETY_LIMIT) {
    let query = supabase.from("ai_agent_runs").select("id,workspace_id,status,created_at,file_upload_id:input_json->extra_inputs->file->>id")
      .eq("workspace_id", workspaceId).eq("agent_type", "file_analysis").is("deleted_at", null).is("archived_at", null)
      .in("status", ["queued", "pending", "running", "processing"]).order("id", { ascending: true }).limit(PAGE_SIZE);
    if (cursor) query = query.gt("id", cursor);
    const result = await query;
    if (result.error) return { data: [], error: result.error };
    const rows = result.data || [];
    runs.push(...rows.map(row => ({ ...row, input_json: { extra_inputs: { file: { id: row.file_upload_id } } } })) as unknown as RunRow[]);
    if (runs.length > BROWSE_SAFETY_LIMIT) break;
    if (rows.length < PAGE_SIZE) return { data: runs.sort((a, b) => b.created_at.localeCompare(a.created_at)), error: null };
    const nextCursor = rows.at(-1)?.id;
    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  }
  return { data: [], error: { message: "Analysis status could not be completely loaded. Open a source to check its current result." } };
}
