import type { ManagedRecordCollection, ManagedRecordFolder } from "@/components/operations/ManagedRecordList";
import type { Json } from "@/lib/supabase/types";

type ManagedValues = {
  folderId: string | null;
  archivedAt: string | null;
  deletedAt: string | null;
  updatedAt: string | null;
};

type SupabaseLike = {
  from: (table: "record_folders") => any;
};

export function managedValues(row: unknown): ManagedValues {
  const value = (row || {}) as Partial<Record<"folder_id" | "archived_at" | "deleted_at" | "updated_at", string | null>>;

  return {
    folderId: value.folder_id || null,
    archivedAt: value.archived_at || null,
    deletedAt: value.deleted_at || null,
    updatedAt: value.updated_at || null
  };
}

export function jsonLines(value: Json | unknown) {
  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
    .filter(Boolean)
    .join("\n");
}

export function shortPreview(value: string | null | undefined, fallback = "No preview available.") {
  const text = (value || "").trim();

  if (!text) {
    return fallback;
  }

  return text.length > 180 ? `${text.slice(0, 180)}...` : text;
}

export async function getRecordFolders(supabase: SupabaseLike, workspaceId: string, collection: ManagedRecordCollection) {
  const { data, error } = await supabase
    .from("record_folders")
    .select("id,name,collection_type,archived_at")
    .eq("workspace_id", workspaceId)
    .eq("collection_type", collection)
    .is("archived_at", null)
    .order("name", { ascending: true });

  return {
    folders: data || [],
    error
  };
}
