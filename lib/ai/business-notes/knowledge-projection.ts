import type { Database } from "@/lib/supabase/types";

type MemoryChunkRow = Database["public"]["Tables"]["business_memory_chunks"]["Row"];

function preferredBusinessNoteChunk(left: MemoryChunkRow, right: MemoryChunkRow) {
  if (left.chunk_index !== right.chunk_index) {
    return left.chunk_index < right.chunk_index ? left : right;
  }
  return left.id.localeCompare(right.id) <= 0 ? left : right;
}

export function collapseBusinessNoteKnowledgeRows(rows: readonly MemoryChunkRow[]) {
  const projected: MemoryChunkRow[] = [];
  const positionByNote = new Map<string, number>();

  for (const row of rows) {
    if (row.source_type !== "business_note" || !row.source_id) {
      projected.push(row);
      continue;
    }

    const key = `${row.workspace_id}:${row.source_id}`;
    const existingPosition = positionByNote.get(key);
    if (existingPosition === undefined) {
      positionByNote.set(key, projected.length);
      projected.push(row);
      continue;
    }

    projected[existingPosition] = preferredBusinessNoteChunk(projected[existingPosition], row);
  }

  return projected;
}
