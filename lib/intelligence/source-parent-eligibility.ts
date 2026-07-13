import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

type SourceLinkedRecord = {
  source_file_id?: string | null;
  import_id?: string | null;
};

type SourceFileRecord = {
  id: string;
  archived_at?: string | null;
  deleted_at?: string | null;
};

type FileImportRecord = {
  id: string;
  file_upload_id: string;
};

export type SourceParentEligibility = {
  activeFileIds: Set<string>;
  importFileIds: Map<string, string>;
};

function batches<T>(values: T[], size = 200) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

export function buildSourceParentEligibility({
  files,
  imports
}: {
  files: SourceFileRecord[];
  imports: FileImportRecord[];
}): SourceParentEligibility {
  return {
    activeFileIds: new Set(files.filter((file) => !file.archived_at && !file.deleted_at).map((file) => file.id)),
    importFileIds: new Map(imports.map((item) => [item.id, item.file_upload_id]))
  };
}

export function filterBySourceParentEligibility<T extends SourceLinkedRecord>(
  rows: T[] | null | undefined,
  eligibility: SourceParentEligibility
) {
  return (rows || []).filter((row) => {
    if (row.source_file_id) return eligibility.activeFileIds.has(row.source_file_id);
    if (!row.import_id) return true;

    const sourceFileId = eligibility.importFileIds.get(row.import_id);
    return Boolean(sourceFileId && eligibility.activeFileIds.has(sourceFileId));
  });
}

export async function loadSourceParentEligibility({
  supabase,
  workspaceId,
  rows
}: {
  supabase: SupabaseClient<Database>;
  workspaceId: string;
  rows: SourceLinkedRecord[];
}) {
  const directFileIds = new Set(rows.flatMap((row) => row.source_file_id ? [row.source_file_id] : []));
  const importIds = Array.from(new Set(rows.flatMap((row) => row.import_id ? [row.import_id] : [])));
  const imports: FileImportRecord[] = [];

  for (const ids of batches(importIds)) {
    const { data, error } = await supabase
      .from("file_imports")
      .select("id,file_upload_id")
      .eq("workspace_id", workspaceId)
      .in("id", ids);

    if (error) throw new Error(`Source import lifecycle could not be verified: ${error.message}`);
    imports.push(...(data || []));
  }

  imports.forEach((item) => directFileIds.add(item.file_upload_id));
  const files: SourceFileRecord[] = [];

  for (const ids of batches(Array.from(directFileIds))) {
    const { data, error } = await supabase
      .from("file_uploads")
      .select("id,archived_at,deleted_at")
      .eq("workspace_id", workspaceId)
      .in("id", ids);

    if (error) throw new Error(`Source lifecycle could not be verified: ${error.message}`);
    files.push(...(data || []));
  }

  return buildSourceParentEligibility({ files, imports });
}

export async function loadSourceParentEligibilityResult(
  args: Parameters<typeof loadSourceParentEligibility>[0]
): Promise<{ eligibility: SourceParentEligibility; error: Error | null }> {
  try {
    return { eligibility: await loadSourceParentEligibility(args), error: null };
  } catch (error) {
    return {
      eligibility: buildSourceParentEligibility({ files: [], imports: [] }),
      error: error instanceof Error ? error : new Error("Source lifecycle could not be verified.")
    };
  }
}
