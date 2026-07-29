import type { ProjectedContextualEvidenceV1 } from "@/lib/intelligence/snapshot/v1/projections";

const ATTRIBUTION_PATTERN = /\b(?:according to|business note|context note|manager (?:reported|noted)|management (?:reported|noted)|owner (?:reported|noted)|leadership (?:reported|noted)|reported context|the note (?:reports|says|states)|was reported|was noted)\b/i;
const CONTEXT_STOP_WORDS = new Set([
  "about", "after", "again", "because", "business", "context", "current", "during", "evidence", "from", "into",
  "management", "more", "note", "reported", "should", "that", "their", "these", "this", "those", "through", "under",
  "what", "when", "where", "which", "while", "with", "without"
]);

function terms(value: string) {
  return new Set(value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length >= 5 && !CONTEXT_STOP_WORDS.has(term)));
}

function numericClaims(value: string) {
  return value.match(/(?<![A-Za-z0-9])-?\$?\d[\d,]*(?:\.\d+)?%?/g) || [];
}

function normalizeNumber(value: string) {
  return value.replace(/[$,%\s]/g, "").replace(/^\+/, "");
}

export function contextualEvidenceGroundingText(records: readonly ProjectedContextualEvidenceV1[]) {
  return records.flatMap((record) => [
    record.title,
    record.summary,
    ...record.departments,
    ...record.topics,
    ...record.entities.flatMap((entity) => [entity.name, entity.sourceQuoteExcerpt]),
    ...record.statements.flatMap((statement) => [statement.text, statement.sourceQuoteExcerpt]),
    ...record.userAddedContext.flatMap((item) => [item.label, item.value])
  ]).join(" ");
}

export function unattributedContextField({
  outputFields,
  deterministicText,
  contextualEvidence
}: {
  outputFields: Readonly<Record<string, string>>;
  deterministicText: string;
  contextualEvidence: readonly ProjectedContextualEvidenceV1[];
}) {
  if (!contextualEvidence.length) return null;
  const contextText = contextualEvidenceGroundingText(contextualEvidence);
  const deterministicTerms = terms(deterministicText);
  const contextualTerms = [...terms(contextText)].filter((term) => !deterministicTerms.has(term));
  const deterministicNumbers = new Set(numericClaims(deterministicText).map(normalizeNumber));
  const contextualNumbers = new Set(numericClaims(contextText).map(normalizeNumber));

  for (const [field, value] of Object.entries(outputFields)) {
    const outputTerms = terms(value);
    const contextualTermMatches = contextualTerms.filter((term) => outputTerms.has(term)).length;
    const usesContextOnlyNumber = numericClaims(value)
      .map(normalizeNumber)
      .some((number) => contextualNumbers.has(number) && !deterministicNumbers.has(number));
    if ((contextualTermMatches >= 2 || usesContextOnlyNumber) && !ATTRIBUTION_PATTERN.test(value)) return field;
  }
  return null;
}

export function businessNoteContextForProvider(records: readonly ProjectedContextualEvidenceV1[]) {
  return records.map((record) => ({
    title: record.title,
    summary: record.summary,
    note_type: record.noteType,
    source_classification: record.sourceClassification,
    departments: record.departments,
    topics: record.topics,
    observed_at: record.observedAt,
    approved_at: record.approvedAt,
    applicable_period: record.applicability,
    extraction_confidence: record.extractionConfidence,
    extracted_statements: record.statements.map((statement) => ({
      kind: statement.kind,
      text: statement.text,
      source_quote_excerpt: statement.sourceQuoteExcerpt,
      confidence: statement.confidence
    })),
    extracted_entities: record.entities.map((entity) => ({
      kind: entity.kind,
      name: entity.name,
      source_quote_excerpt: entity.sourceQuoteExcerpt
    })),
    user_supplied_context: record.userAddedContext.map((item) => ({
      label: item.label,
      value: item.value,
      provenance: item.provenance,
      user_provided: item.userProvided,
      evidence_treatment: item.evidenceTreatment,
      part_of_original_note_quotation: item.partOfOriginalNoteQuotation
    }))
  }));
}
