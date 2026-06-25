import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

type FileUploadForAccess = Pick<
  Database["public"]["Tables"]["file_uploads"]["Row"],
  "id" | "original_name" | "storage_bucket" | "storage_path"
>;

export type FileAccessLinks = {
  viewUrl: string | null;
  downloadUrl: string | null;
  error: string | null;
};

const FILE_LINK_EXPIRY_SECONDS = 60 * 10;
const FILE_LINK_ERROR = "Vaeroex could not create a secure link to the original file.";

export async function createFileAccessLinks(
  supabase: SupabaseClient<Database>,
  file: FileUploadForAccess
): Promise<FileAccessLinks> {
  if (!file.storage_bucket || !file.storage_path) {
    return {
      viewUrl: null,
      downloadUrl: null,
      error: "The original file location is missing."
    };
  }

  const storage = supabase.storage.from(file.storage_bucket);
  const [viewResult, downloadResult] = await Promise.all([
    storage.createSignedUrl(file.storage_path, FILE_LINK_EXPIRY_SECONDS),
    storage.createSignedUrl(file.storage_path, FILE_LINK_EXPIRY_SECONDS, { download: file.original_name })
  ]);

  const viewUrl = viewResult.data?.signedUrl || null;
  const downloadUrl = downloadResult.data?.signedUrl || viewUrl;

  return {
    viewUrl,
    downloadUrl,
    error: viewUrl ? null : FILE_LINK_ERROR
  };
}

export async function createFileAccessLinkMap(
  supabase: SupabaseClient<Database>,
  files: FileUploadForAccess[]
) {
  const entries = await Promise.all(files.map(async (file) => [file.id, await createFileAccessLinks(supabase, file)] as const));

  return new Map(entries);
}
