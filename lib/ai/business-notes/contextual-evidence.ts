import "server-only";

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BUSINESS_NOTE_ADDITIONAL_CONTEXT_KEYS,
  type BusinessNoteExtraction,
  type BusinessNoteReleaseChannel,
  type BusinessNoteUserAddedContext
} from "@/lib/ai/business-notes/contracts";
import {
  buildBusinessNoteContextRecordV1,
  type BusinessNoteContextRecordV1
} from "@/lib/ai/business-notes/contextual-contract";
import { validateBusinessNoteExtraction } from "@/lib/ai/business-notes/validation";
import { snapshotHash } from "@/lib/intelligence/snapshot/v1/canonical";
import type { Database } from "@/lib/supabase/types";

type BusinessNoteRow = Database["public"]["Tables"]["business_notes"]["Row"];

const userAddedContextSchema = z.array(z.object({
  field: z.enum(BUSINESS_NOTE_ADDITIONAL_CONTEXT_KEYS),
  label: z.string().trim().min(1).max(240),
  value: z.string().trim().min(1).max(240),
  provenance: z.literal("supplied_during_review"),
  userProvided: z.literal(true),
  partOfOriginalNoteQuotation: z.literal(false),
  evidenceTreatment: z.literal("contextual_metadata")
}).strict()).max(3);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function reviewedExtraction(note: BusinessNoteRow): BusinessNoteExtraction | null {
  const original = validateBusinessNoteExtraction(note.extraction_json, note.original_note_text);
  if (!original.ok) return null;
  const reviewed = record(note.reviewed_extraction_json);
  const validated = validateBusinessNoteExtraction({
    ...reviewed,
    reportingPeriod: original.value.reportingPeriod
  }, note.original_note_text);
  if (!validated.ok) return null;
  return {
    ...validated.value,
    reportingPeriod: {
      ...validated.value.reportingPeriod,
      start: note.user_reporting_period_start || validated.value.reportingPeriod.start,
      end: note.user_reporting_period_end || validated.value.reportingPeriod.end,
      inferred: note.user_reporting_period_start || note.user_reporting_period_end
        ? false
        : validated.value.reportingPeriod.inferred
    }
  };
}

function reviewedUserContext(note: BusinessNoteRow): BusinessNoteUserAddedContext[] | null {
  const value = record(note.user_corrections_json).userAddedContext;
  const parsed = userAddedContextSchema.safeParse(value || []);
  return parsed.success ? parsed.data : null;
}

export type BusinessNoteContextLoadResult = Readonly<{
  records: readonly BusinessNoteContextRecordV1[];
  rejectedRecordCount: number;
  error: Error | null;
}>;

export async function loadApprovedBusinessNoteContextV1({
  supabase,
  workspaceId,
  releaseChannel,
  asOf,
  maximumRows = 50
}: {
  supabase: SupabaseClient<Database>;
  workspaceId: string;
  releaseChannel: BusinessNoteReleaseChannel;
  asOf: string;
  maximumRows?: number;
}): Promise<BusinessNoteContextLoadResult> {
  if (!workspaceId.trim()) return { records: [], rejectedRecordCount: 0, error: new Error("workspaceId is required.") };
  if (!Number.isFinite(Date.parse(asOf))) return { records: [], rejectedRecordCount: 0, error: new Error("Business Note context asOf is invalid.") };

  const notesResult = await supabase
    .from("business_notes")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("release_channel", releaseChannel)
    .eq("status", "approved")
    .eq("evidence_lifecycle_status", "active")
    .is("archived_at", null)
    .is("deleted_at", null)
    .lte("approved_at", asOf)
    .order("approved_at", { ascending: false })
    .limit(Math.min(Math.max(maximumRows, 1), 100));
  if (notesResult.error) return { records: [], rejectedRecordCount: 0, error: new Error(notesResult.error.message) };

  const notes = (notesResult.data || []) as BusinessNoteRow[];
  if (!notes.length) return { records: [], rejectedRecordCount: 0, error: null };
  const noteIds = notes.map((note) => note.id);
  const chunksResult = await supabase
    .from("business_memory_chunks")
    .select("source_id")
    .eq("workspace_id", workspaceId)
    .eq("source_type", "business_note")
    .in("source_id", noteIds)
    .lte("indexed_at", asOf)
    .is("archived_at", null)
    .is("deleted_at", null);
  if (chunksResult.error) return { records: [], rejectedRecordCount: notes.length, error: new Error(chunksResult.error.message) };

  const indexedNoteIds = new Set((chunksResult.data || []).flatMap((chunk) => chunk.source_id ? [chunk.source_id] : []));
  const evaluationDate = asOf.slice(0, 10);
  const records: BusinessNoteContextRecordV1[] = [];
  let rejectedRecordCount = 0;
  for (const note of notes) {
    if (!indexedNoteIds.has(note.id)) {
      rejectedRecordCount += 1;
      continue;
    }
    const extraction = reviewedExtraction(note);
    const userAddedContext = reviewedUserContext(note);
    if (!extraction || !userAddedContext) {
      rejectedRecordCount += 1;
      continue;
    }
    const context = buildBusinessNoteContextRecordV1({
      note,
      extraction,
      userAddedContext,
      reviewedExtractionHash: snapshotHash(note.reviewed_extraction_json),
      evaluationDate
    });
    if (context) records.push(context);
  }

  return { records, rejectedRecordCount, error: null };
}
