import "server-only";

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BusinessNoteExtraction } from "@/lib/ai/business-notes/contracts";
import { chunkEvidenceText } from "@/lib/ai/evidence-index";
import { createAIEmbeddings } from "@/lib/ai/providers/provider-manager";
import { estimateTokenCount } from "@/lib/ai/usage";
import type { Database, Json } from "@/lib/supabase/types";

type BusinessNoteRow = Database["public"]["Tables"]["business_notes"]["Row"];
type MemoryChunkInsert = Database["public"]["Tables"]["business_memory_chunks"]["Insert"];

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function periodLabel(extraction: BusinessNoteExtraction) {
  const { start, end } = extraction.reportingPeriod;
  if (start && end) return start === end ? start : `${start} to ${end}`;
  return start || end || "Not specified";
}

function approvedContextText(extraction: BusinessNoteExtraction) {
  const lines = [
    `Business Note: ${extraction.title}`,
    `Note type: ${extraction.noteType.replace(/_/g, " ")}`,
    `Source classification: ${extraction.sourceClassification.replace(/_/g, " ")}`,
    `Departments: ${extraction.departments.join(", ") || "Not specified"}`,
    `Topics: ${extraction.topics.join(", ") || "Not specified"}`,
    `Reporting period: ${periodLabel(extraction)}`,
    `Context summary: ${extraction.summary}`
  ];
  const add = (label: string, values: readonly { text: string; quote: string }[]) => {
    values.forEach((item) => lines.push(`${label}: ${item.text}\nExact note quotation: ${item.quote}`));
  };

  add("Reported fact", extraction.explicitFacts.map((item) => ({ text: item.statement, quote: item.sourceQuote })));
  add("Opinion or assumption", extraction.opinionsOrAssumptions.map((item) => ({ text: item.statement, quote: item.sourceQuote })));
  add("Reported risk", extraction.risks.map((item) => ({ text: item.description, quote: item.sourceQuote })));
  add("Reported opportunity", extraction.opportunities.map((item) => ({ text: item.description, quote: item.sourceQuote })));
  add("Reported decision", extraction.decisions.map((item) => ({ text: item.description, quote: item.sourceQuote })));
  add("Mentioned person", extraction.peopleMentioned.map((item) => ({ text: item.name, quote: item.sourceQuote })));
  add("Mentioned customer", extraction.customersMentioned.map((item) => ({ text: item.name, quote: item.sourceQuote })));
  add("Mentioned vendor", extraction.vendorsMentioned.map((item) => ({ text: item.name, quote: item.sourceQuote })));
  add("Mentioned project", extraction.projectsMentioned.map((item) => ({ text: item.name, quote: item.sourceQuote })));
  add("Reported metric (unverified)", extraction.mentionedMetrics.map((item) => ({
    text: `${item.name}: ${item.value === null ? "value not specified" : item.value}${item.unit ? ` ${item.unit}` : ""}`,
    quote: item.sourceQuote
  })));

  return lines.join("\n\n");
}

function applicationConfidenceScore(extraction: BusinessNoteExtraction) {
  const treatmentBase = extraction.evidenceTreatment === "potentially_supporting" ? 35 : 28;
  return Math.min(55, treatmentBase + Math.round(extraction.extractionConfidence * 20));
}

export async function indexApprovedBusinessNote({
  supabase,
  workspaceId,
  note,
  extraction,
  approvedBy
}: {
  supabase: SupabaseClient<Database>;
  workspaceId: string;
  note: BusinessNoteRow;
  extraction: BusinessNoteExtraction;
  approvedBy: string;
}) {
  if (note.workspace_id !== workspaceId || note.deleted_at || note.archived_at || note.status !== "review_required") {
    return { indexedChunks: 0, error: "This Business Note is not available for approval." };
  }
  if (extraction.extractionDisposition !== "extractable") {
    return { indexedChunks: 0, error: "This note does not contain approved business context to add to Evidence." };
  }

  const contextualText = approvedContextText(extraction);
  const chunks = chunkEvidenceText(contextualText);
  if (!chunks.length) return { indexedChunks: 0, error: "No approved Business Note context was available to index." };

  const embedding = await createAIEmbeddings(chunks);
  const indexedAt = new Date().toISOString();
  const confidenceScore = applicationConfidenceScore(extraction);
  const rows = chunks.map<MemoryChunkInsert>((chunk, index) => ({
    workspace_id: workspaceId,
    source_type: "business_note",
    source_id: note.id,
    source_file_id: note.original_file_id,
    source_title: extraction.title,
    source_excerpt: chunk,
    summary: extraction.summary,
    chunk_index: index,
    content_hash: hash(`${note.id}:${note.source_version}:${index}:${chunk}`),
    embedding: embedding.embeddings[index] || null,
    embedding_model: embedding.embeddings[index] ? embedding.model : null,
    source_metadata: {
      source_record_type: "business_note",
      source_record_id: note.id,
      source_version: note.source_version,
      release_channel: note.release_channel,
      evidence_classification: "business_evidence",
      evidence_lifecycle: "active",
      evidence_role: "supporting",
      evidence_treatment: "contextual",
      proposed_evidence_treatment: extraction.evidenceTreatment,
      original_evidence_eligible: false,
      verification_state: "unverified_observation",
      note_derived_quantities_unverified: true,
      extraction_outcome: "completed",
      review_status: "approved",
      trust_level: "reviewed_contextual",
      note_type: extraction.noteType,
      source_classification: extraction.sourceClassification,
      departments: [...extraction.departments],
      topics: [...extraction.topics],
      reporting_period_start: extraction.reportingPeriod.start,
      reporting_period_end: extraction.reportingPeriod.end,
      approved_by: approvedBy,
      indexing_method: embedding.embeddings[index] ? "openai_embedding" : "text_only",
      embedding_error_code: embedding.error ? "embedding_unavailable" : null,
      invalidated_at: null,
      invalidation_reason: null
    } satisfies Json,
    source_quality: "medium",
    confidence_score: confidenceScore,
    token_estimate: estimateTokenCount(chunk),
    indexed_at: indexedAt,
    archived_at: null,
    deleted_at: null
  }));
  const { error } = await supabase.from("business_memory_chunks").upsert(rows, {
    onConflict: "workspace_id,source_type,source_id,content_hash,chunk_index"
  });

  return {
    indexedChunks: error ? 0 : rows.length,
    error: error?.message || null,
    embeddingWarning: embedding.error ? "Business Note is available through text retrieval while semantic indexing is unavailable." : null
  };
}
