import type {
  BusinessNoteExtraction,
  BusinessNoteReleaseChannel,
  BusinessNoteSourceClassification,
  BusinessNoteType,
  BusinessNoteUserAddedContext
} from "@/lib/ai/business-notes/contracts";

export const BUSINESS_NOTE_CONTEXT_RECORD_VERSION = "business_note_context_record_v1" as const;
export const BUSINESS_NOTE_CONTEXT_PROVENANCE_VERSION = "business_note_context_provenance_v1" as const;

export type BusinessNoteContextStatementKind =
  | "reported_fact"
  | "opinion_or_assumption"
  | "reported_risk"
  | "reported_opportunity"
  | "reported_decision"
  | "reported_metric";

export type BusinessNoteContextStatementV1 = Readonly<{
  id: string;
  kind: BusinessNoteContextStatementKind;
  text: string;
  sourceQuote: string;
  confidence: number;
  provenance: "original_note_extraction";
}>;

export type BusinessNoteContextEntityV1 = Readonly<{
  id: string;
  kind: "person" | "customer" | "vendor" | "project";
  name: string;
  sourceQuote: string;
  provenance: "original_note_extraction";
}>;

export type BusinessNoteContextApplicabilityV1 = Readonly<{
  start: string | null;
  end: string | null;
  source: "user_review" | "validated_extraction" | "undated";
  temporalStatus: "applicable" | "upcoming" | "undated";
}>;

export type BusinessNoteContextRecordV1 = Readonly<{
  contractVersion: typeof BUSINESS_NOTE_CONTEXT_RECORD_VERSION;
  id: string;
  workspaceId: string;
  releaseChannel: BusinessNoteReleaseChannel;
  sourceNoteId: string;
  sourceVersion: number;
  sourceTextHash: string;
  authorityRole: "supporting_context";
  originalEvidenceEligible: false;
  lifecycle: "active";
  validationState: "approved_review";
  title: string;
  summary: string;
  noteType: BusinessNoteType;
  sourceClassification: BusinessNoteSourceClassification;
  departments: readonly string[];
  topics: readonly string[];
  entities: readonly BusinessNoteContextEntityV1[];
  statements: readonly BusinessNoteContextStatementV1[];
  userAddedContext: readonly BusinessNoteUserAddedContext[];
  applicability: BusinessNoteContextApplicabilityV1;
  extractionConfidence: number;
  approvedAt: string;
  observedAt: string | null;
  provenance: Readonly<{
    version: typeof BUSINESS_NOTE_CONTEXT_PROVENANCE_VERSION;
    extractionVersion: string;
    validatorVersion: string;
    policyVersion: string;
    providerName: string | null;
    modelUsed: string | null;
    fallbackUsed: boolean;
    reviewedExtractionHash: string;
    userContextProvenance: "separate_review_context";
  }>;
}>;

function metricText(metric: BusinessNoteExtraction["mentionedMetrics"][number]) {
  const value = metric.value === null ? "value not specified" : `${metric.value}${metric.unit ? ` ${metric.unit}` : ""}`;
  return `${metric.name}: ${value}`;
}

function contextStatements(noteId: string, extraction: BusinessNoteExtraction): BusinessNoteContextStatementV1[] {
  const statement = (
    kind: BusinessNoteContextStatementKind,
    values: readonly { text: string; sourceQuote: string; confidence: number }[]
  ) => values.map((item, index) => ({
    id: `${noteId}:${kind}:${index + 1}`,
    kind,
    text: item.text,
    sourceQuote: item.sourceQuote,
    confidence: item.confidence,
    provenance: "original_note_extraction" as const
  }));

  return [
    ...statement("reported_fact", extraction.explicitFacts.map((item) => ({
      text: item.statement,
      sourceQuote: item.sourceQuote,
      confidence: item.confidence
    }))),
    ...statement("opinion_or_assumption", extraction.opinionsOrAssumptions.map((item) => ({
      text: item.statement,
      sourceQuote: item.sourceQuote,
      confidence: item.confidence
    }))),
    ...statement("reported_risk", extraction.risks.map((item) => ({
      text: item.description,
      sourceQuote: item.sourceQuote,
      confidence: item.confidence
    }))),
    ...statement("reported_opportunity", extraction.opportunities.map((item) => ({
      text: item.description,
      sourceQuote: item.sourceQuote,
      confidence: item.confidence
    }))),
    ...statement("reported_decision", extraction.decisions.map((item) => ({
      text: item.description,
      sourceQuote: item.sourceQuote,
      confidence: item.confidence
    }))),
    ...statement("reported_metric", extraction.mentionedMetrics.map((item) => ({
      text: metricText(item),
      sourceQuote: item.sourceQuote,
      confidence: item.confidence
    })))
  ];
}

function contextEntities(noteId: string, extraction: BusinessNoteExtraction): BusinessNoteContextEntityV1[] {
  const entity = (
    kind: BusinessNoteContextEntityV1["kind"],
    values: readonly { name: string; sourceQuote: string }[]
  ) => values.map((item, index) => ({
    id: `${noteId}:${kind}:${index + 1}`,
    kind,
    name: item.name,
    sourceQuote: item.sourceQuote,
    provenance: "original_note_extraction" as const
  }));

  return [
    ...entity("person", extraction.peopleMentioned),
    ...entity("customer", extraction.customersMentioned),
    ...entity("vendor", extraction.vendorsMentioned),
    ...entity("project", extraction.projectsMentioned)
  ];
}

function applicability({
  extraction,
  userStart,
  userEnd,
  evaluationDate
}: {
  extraction: BusinessNoteExtraction;
  userStart: string | null;
  userEnd: string | null;
  evaluationDate: string;
}): BusinessNoteContextApplicabilityV1 | null {
  const start = userStart || extraction.reportingPeriod.start;
  const end = userEnd || extraction.reportingPeriod.end;
  if (end && end < evaluationDate) return null;
  if (!start && !end) return { start: null, end: null, source: "undated", temporalStatus: "undated" };
  return {
    start,
    end,
    source: userStart || userEnd ? "user_review" : "validated_extraction",
    temporalStatus: start && start > evaluationDate ? "upcoming" : "applicable"
  };
}

export function buildBusinessNoteContextRecordV1({
  note,
  extraction,
  userAddedContext,
  reviewedExtractionHash,
  evaluationDate
}: {
  note: Readonly<{
    id: string;
    workspace_id: string;
    source_version: number;
    source_text_hash: string;
    release_channel: BusinessNoteReleaseChannel;
    evidence_lifecycle_status: "active" | "inactive" | "archived";
    status: string;
    deleted_at: string | null;
    archived_at: string | null;
    user_observation_date: string | null;
    user_reporting_period_start: string | null;
    user_reporting_period_end: string | null;
    extraction_version: string;
    validator_version: string;
    policy_version: string;
    provider_name: string | null;
    model_used: string | null;
    fallback_used: boolean;
    approved_at: string | null;
  }>;
  extraction: BusinessNoteExtraction;
  userAddedContext: readonly BusinessNoteUserAddedContext[];
  reviewedExtractionHash: string;
  evaluationDate: string;
}): BusinessNoteContextRecordV1 | null {
  if (
    note.status !== "approved"
    || note.evidence_lifecycle_status !== "active"
    || note.deleted_at
    || note.archived_at
    || !note.approved_at
    || extraction.extractionDisposition !== "extractable"
  ) return null;

  const applicable = applicability({
    extraction,
    userStart: note.user_reporting_period_start,
    userEnd: note.user_reporting_period_end,
    evaluationDate
  });
  if (!applicable) return null;

  return {
    contractVersion: BUSINESS_NOTE_CONTEXT_RECORD_VERSION,
    id: `business-note-context:${note.id}:v${note.source_version}`,
    workspaceId: note.workspace_id,
    releaseChannel: note.release_channel,
    sourceNoteId: note.id,
    sourceVersion: note.source_version,
    sourceTextHash: note.source_text_hash,
    authorityRole: "supporting_context",
    originalEvidenceEligible: false,
    lifecycle: "active",
    validationState: "approved_review",
    title: extraction.title,
    summary: extraction.summary,
    noteType: extraction.noteType,
    sourceClassification: extraction.sourceClassification,
    departments: extraction.departments,
    topics: extraction.topics,
    entities: contextEntities(note.id, extraction),
    statements: contextStatements(note.id, extraction),
    userAddedContext,
    applicability: applicable,
    extractionConfidence: extraction.extractionConfidence,
    approvedAt: note.approved_at,
    observedAt: note.user_observation_date,
    provenance: {
      version: BUSINESS_NOTE_CONTEXT_PROVENANCE_VERSION,
      extractionVersion: note.extraction_version,
      validatorVersion: note.validator_version,
      policyVersion: note.policy_version,
      providerName: note.provider_name,
      modelUsed: note.model_used,
      fallbackUsed: note.fallback_used,
      reviewedExtractionHash,
      userContextProvenance: "separate_review_context"
    }
  };
}
