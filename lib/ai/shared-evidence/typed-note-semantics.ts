import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { reviewedExtraction, reviewedUserContext } from "@/lib/ai/business-notes/contextual-evidence";
import { approvedContextText } from "@/lib/ai/business-notes/approved-context-text";
import { chunkEvidenceText } from "@/lib/ai/evidence-index";

// Database provenance checks do not replace the existing reviewed-text validator.
// This module is inactive until shared provider/lifecycle gates are qualified.
const projection = z.object({
  provider: z.literal("business_note"), workspace_id: z.string().uuid(), entity_id: z.null(),
  note_id: z.string().uuid(), source_version: z.number().int().positive(), source_text_hash: z.string().regex(/^[a-f0-9]{64}$/),
  original_note_text: z.string().min(1), extraction: z.unknown(), reviewed_extraction: z.unknown(),
  user_corrections: z.unknown(), user_reporting_period_start: z.string().nullable(), user_reporting_period_end: z.string().nullable(),
  chunk_id: z.string().uuid(), chunk_index: z.number().int().nonnegative(), content_hash: z.string().regex(/^[a-f0-9]{64}$/),
  treatment: z.literal("supporting_context")
});
export function validateTypedNoteProjection(raw: unknown) {
  const source = projection.parse(raw);
  if (createHash("sha256").update(source.original_note_text).digest("hex") !== source.source_text_hash) {
    throw new Error("shared_note_source_text_mismatch");
  }
  const note = { original_note_text: source.original_note_text, extraction_json: source.extraction,
    reviewed_extraction_json: source.reviewed_extraction, user_corrections_json: source.user_corrections,
    user_reporting_period_start: source.user_reporting_period_start, user_reporting_period_end: source.user_reporting_period_end };
  const extraction = reviewedExtraction(note as Parameters<typeof reviewedExtraction>[0]);
  const context = reviewedUserContext(note as Parameters<typeof reviewedUserContext>[0]);
  if (!extraction || !context || extraction.extractionDisposition !== "extractable") throw new Error("shared_note_semantics_invalid");
  const chunks = chunkEvidenceText(approvedContextText(extraction, context));
  const text = chunks[source.chunk_index];
  if (!text || createHash("sha256").update(`${source.note_id}:${source.source_version}:${source.chunk_index}:${text}`).digest("hex") !== source.content_hash) {
    throw new Error("shared_note_reviewed_chunk_mismatch");
  }
  return { stage: "unadmitted" as const, workspaceId: source.workspace_id, noteId: source.note_id,
    chunkId: source.chunk_id, text, treatment: "supporting_context" as const,
    limitation: "The business reported this context; it does not independently establish causation.",
    url: `/app/sources?note=${encodeURIComponent(source.note_id)}#business-notes` };
}
