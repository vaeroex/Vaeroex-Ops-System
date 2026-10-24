import "server-only";
import { z } from "zod";
import { filterEligibleMemoryRows } from "@/lib/ai/evidence-index";
import { validateTypedNoteProjection } from "./typed-note-semantics";

const snapshot = z.object({
  chunk: z.object({ id: z.string().uuid(), workspace_id: z.string().uuid() }).passthrough(),
  files: z.array(z.object({ id: z.string().uuid() }).passthrough()),
  runs: z.array(z.object({ id: z.string().uuid() }).passthrough()),
  notes: z.array(z.object({ id: z.string().uuid(), workspace_id: z.string().uuid() }).passthrough()),
  worksheetHeads: z.array(z.tuple([z.string().uuid(), z.string().uuid().nullable()]))
}).strict();

/** Use the existing eligibility decision, including nested invalidation,
 * file metadata, parent-run exclusions and worksheet publication heads. This
 * authority snapshot is never forwarded to the model or saved as answer text. */
export function validateSharedMemoryProjection(raw: unknown, workspaceId: string) {
  const data = z.object({ provider: z.enum(["file", "business_note"]), workspace_id: z.string().uuid(),
    chunk_id: z.string().uuid(), eligibility: snapshot }).passthrough().parse(raw);
  if (data.workspace_id !== workspaceId || data.eligibility.chunk.workspace_id !== workspaceId
    || data.chunk_id !== data.eligibility.chunk.id) throw new Error("shared_memory_workspace_mismatch");
  const value = data.eligibility;
  type Input = Parameters<typeof filterEligibleMemoryRows>[0];
  const eligible = filterEligibleMemoryRows({ workspaceId, rows: [value.chunk] as Input["rows"],
    files: value.files as Input["files"], runs: value.runs as Input["runs"], notes: value.notes as Input["notes"],
    worksheetHeads: new Map(value.worksheetHeads) });
  if (eligible.length !== 1) throw new Error("shared_memory_ineligible");
  if (data.provider === "business_note") return validateTypedNoteProjection(data);
  const file = z.object({ file_id: z.string().uuid(), excerpt: z.string().min(1), authority: z.object({ eligible: z.literal(true) }).passthrough() }).parse(data);
  return { stage: "unadmitted" as const, workspaceId, chunkId: data.chunk_id, fileId: file.file_id,
    text: file.excerpt, treatment: "reviewed_extracted_context" as const,
    url: `/app/sources/${encodeURIComponent(file.file_id)}` };
}
