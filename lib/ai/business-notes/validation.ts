import "server-only";

import { z } from "zod";
import {
  BUSINESS_NOTE_EVIDENCE_TREATMENTS,
  BUSINESS_NOTE_EXTRACTION_DISPOSITIONS,
  BUSINESS_NOTE_EXTRACTION_SCHEMA_VERSION,
  BUSINESS_NOTE_SOURCE_CLASSIFICATIONS,
  BUSINESS_NOTE_TYPES,
  type BusinessNoteExtraction,
  type BusinessNoteReviewCorrections,
  type BusinessNoteReviewWarning,
  type BusinessNoteSourceSpan
} from "@/lib/ai/business-notes/contracts";
import { businessNoteAdditionalContextPrompts } from "@/lib/ai/business-notes/review-context";
import type { StructuredOutputValidation } from "@/lib/ai/providers/provider-manager";
import { validateAiGeneratedOutput } from "@/lib/security/ai-output-validation";
import {
  validationFailure,
  validationValueType,
  type AIValidationReasonCode,
  type AIValidationStage
} from "@/lib/ai/validation-diagnostics";
import type { Json } from "@/lib/supabase/types";

const shortText = z.string().trim().min(1).max(240);
const sourceQuote = z.string().min(1).max(2_000);
const confidence = z.number().finite().min(0).max(1);
const quotedEntity = z.object({ name: shortText, sourceQuote }).strict();
const quotedStatement = z.object({ statement: z.string().trim().min(1).max(600), sourceQuote, confidence }).strict();
const quotedDescription = z.object({ description: z.string().trim().min(1).max(600), sourceQuote, confidence }).strict();
const extractionSchema = z.object({
  schemaVersion: z.literal(BUSINESS_NOTE_EXTRACTION_SCHEMA_VERSION),
  extractionDisposition: z.enum(BUSINESS_NOTE_EXTRACTION_DISPOSITIONS),
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(800),
  noteType: z.enum(BUSINESS_NOTE_TYPES),
  sourceClassification: z.enum(BUSINESS_NOTE_SOURCE_CLASSIFICATIONS),
  departments: z.array(shortText).max(20),
  topics: z.array(shortText).max(30),
  peopleMentioned: z.array(quotedEntity).max(30),
  customersMentioned: z.array(quotedEntity).max(30),
  vendorsMentioned: z.array(quotedEntity).max(30),
  projectsMentioned: z.array(quotedEntity).max(30),
  explicitFacts: z.array(quotedStatement).max(40),
  opinionsOrAssumptions: z.array(quotedStatement).max(40),
  risks: z.array(quotedDescription).max(30),
  opportunities: z.array(quotedDescription).max(30),
  decisions: z.array(quotedDescription).max(30),
  mentionedMetrics: z.array(z.object({
    name: shortText,
    value: z.number().finite().nullable(),
    unit: z.string().trim().min(1).max(80).nullable(),
    sourceQuote,
    confidence
  }).strict()).max(40),
  reportingPeriod: z.object({
    start: z.string().nullable(),
    end: z.string().nullable(),
    inferred: z.boolean(),
    sourceQuote: sourceQuote.nullable()
  }).strict(),
  evidenceTreatment: z.enum(BUSINESS_NOTE_EVIDENCE_TREATMENTS),
  extractionConfidence: confidence,
  missingContext: z.array(z.string().trim().min(1).max(300)).max(30)
}).strict();

const STOP_WORDS = new Set(["the", "and", "for", "with", "that", "this", "from", "was", "were", "are", "has", "have", "had", "into", "about"]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER_PATTERN = /[-+]?\d[\d,.]*(?:%|x|k|m|b)?/gi;
const NUMBER_WORDS = new Map([
  ["zero", "0"], ["one", "1"], ["two", "2"], ["three", "3"], ["four", "4"],
  ["five", "5"], ["six", "6"], ["seven", "7"], ["eight", "8"], ["nine", "9"],
  ["ten", "10"], ["eleven", "11"], ["twelve", "12"], ["thirteen", "13"],
  ["fourteen", "14"], ["fifteen", "15"], ["sixteen", "16"], ["seventeen", "17"],
  ["eighteen", "18"], ["nineteen", "19"], ["twenty", "20"]
]);
const REASONING_LEAKAGE = /\b(?:chain of thought|hidden reasoning|internal reasoning|system prompt|developer message)\b/i;
const SUBJECTIVE_LANGUAGE = /\b(?:i|we)\s+(?:think|believe|assume|suspect|feel|expect)\b|\b(?:probably|possibly|likely|unlikely|seems?|appears?|may|might|could)\b/i;
const CAUSAL_LANGUAGE = /\b(?:caused?|because of|due to|led to|resulted in|driven by|responsible for|contributed to|made)\b/i;
const INFORMAL_TERM_EQUIVALENTS = new Map([
  ["employee", "staff"],
  ["employees", "staff"],
  ["late", "delay"],
  ["lateness", "delay"],
  ["delay", "delay"],
  ["delayed", "delay"],
  ["delays", "delay"],
  ["ready", "prepare"],
  ["readiness", "prepare"],
  ["prepare", "prepare"],
  ["prepared", "prepare"],
  ["preparing", "prepare"],
  ["preparation", "prepare"],
  ["unhappy", "negative_customer_sentiment"],
  ["dissatisfied", "negative_customer_sentiment"],
  ["dissatisfaction", "negative_customer_sentiment"],
  ["displeased", "negative_customer_sentiment"]
]);

function normalized(value: string) {
  return value
    .toLowerCase()
    .replace(/\b(?:isn['\u2019]?t|isnt|wasn['\u2019]?t|wasnt)\s+(?:very\s+)?happy\b/g, "negative_customer_sentiment")
    .replace(/[^a-z0-9%$]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stemTerm(value: string) {
  if (value.endsWith("ies") && value.length > 4) return `${value.slice(0, -3)}y`;
  if (value.endsWith("ing") && value.length > 5) return value.slice(0, -3);
  if (value.endsWith("ed") && value.length > 4) return value.slice(0, -2);
  if (value.endsWith("s") && !value.endsWith("ss") && value.length > 3) return value.slice(0, -1);
  return value;
}

function meaningfulTerms(value: string) {
  return normalized(value).split(" ").filter((term) => term.length > 2 && !STOP_WORDS.has(term)).map((term) => {
    const stemmed = stemTerm(term);
    return INFORMAL_TERM_EQUIVALENTS.get(term) || INFORMAL_TERM_EQUIVALENTS.get(stemmed) || stemmed;
  });
}

function dateValue(value: string | null) {
  if (value === null) return true;
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function exactQuoteSpan(originalNote: string, quote: string) {
  const start = originalNote.indexOf(quote);
  return start >= 0 ? { start, end: start + quote.length } : null;
}

function numericTokens(value: string) {
  const digits = (value.match(NUMBER_PATTERN) || []).map((item) => item.toLowerCase().replace(/,/g, "").replace(/\.$/, ""));
  const words = normalized(value).split(" ").flatMap((item) => {
    const number = NUMBER_WORDS.get(item);
    return number === undefined ? [] : [number];
  });
  return [...digits, ...words];
}

function statementSupportedByQuote(statement: string, quote: string) {
  const statementNumbers = numericTokens(statement);
  const quoteNumbers = new Set(numericTokens(quote));
  if (statementNumbers.some((number) => !quoteNumbers.has(number))) return false;
  if (CAUSAL_LANGUAGE.test(statement) && !CAUSAL_LANGUAGE.test(quote)) return false;

  const statementTerms = meaningfulTerms(statement);
  if (!statementTerms.length) return true;
  const quoteTerms = new Set(meaningfulTerms(quote));
  const overlap = statementTerms.filter((term) => quoteTerms.has(term)).length;
  return overlap >= Math.max(1, Math.ceil(statementTerms.length * 0.45));
}

function listEntries(extraction: BusinessNoteExtraction) {
  return [
    ...extraction.peopleMentioned.map((item, index) => ({ path: `peopleMentioned.${index}`, text: item.name, quote: item.sourceQuote })),
    ...extraction.customersMentioned.map((item, index) => ({ path: `customersMentioned.${index}`, text: item.name, quote: item.sourceQuote })),
    ...extraction.vendorsMentioned.map((item, index) => ({ path: `vendorsMentioned.${index}`, text: item.name, quote: item.sourceQuote })),
    ...extraction.projectsMentioned.map((item, index) => ({ path: `projectsMentioned.${index}`, text: item.name, quote: item.sourceQuote })),
    ...extraction.explicitFacts.map((item, index) => ({ path: `explicitFacts.${index}`, text: item.statement, quote: item.sourceQuote })),
    ...extraction.opinionsOrAssumptions.map((item, index) => ({ path: `opinionsOrAssumptions.${index}`, text: item.statement, quote: item.sourceQuote })),
    ...extraction.risks.map((item, index) => ({ path: `risks.${index}`, text: item.description, quote: item.sourceQuote })),
    ...extraction.opportunities.map((item, index) => ({ path: `opportunities.${index}`, text: item.description, quote: item.sourceQuote })),
    ...extraction.decisions.map((item, index) => ({ path: `decisions.${index}`, text: item.description, quote: item.sourceQuote })),
    ...extraction.mentionedMetrics.map((item, index) => ({ path: `mentionedMetrics.${index}`, text: item.name, quote: item.sourceQuote }))
  ];
}

function canonicalFailure(
  reason: string,
  expectedField = "$",
  reasonCode: AIValidationReasonCode = "contextual_validation_failed",
  stage: AIValidationStage = "contextual_validation"
): StructuredOutputValidation<never> {
  return validationFailure(reason, {
    reasonCode,
    stage,
    expectedField,
    truncationDetected: false
  });
}

function normalizeUncertainClassifications(
  extraction: BusinessNoteExtraction,
  originalNote: string
): BusinessNoteExtraction {
  const opinionLikeFacts = extraction.explicitFacts.filter((fact) => (
    SUBJECTIVE_LANGUAGE.test(fact.sourceQuote) || CAUSAL_LANGUAGE.test(fact.sourceQuote)
  ));
  const departments = extraction.departments.filter((department) => (
    normalized(originalNote).includes(normalized(department))
  ));
  const topics = extraction.topics.filter((topic) => (
    normalized(originalNote).includes(normalized(topic))
  ));
  const removedUnquotedClassifications = (
    departments.length !== extraction.departments.length || topics.length !== extraction.topics.length
  );
  if (!opinionLikeFacts.length && !removedUnquotedClassifications) return extraction;

  const existing = new Set(extraction.opinionsOrAssumptions.map((item) => `${item.statement}\u0000${item.sourceQuote}`));
  const combinedOpinions = [
    ...extraction.opinionsOrAssumptions,
    ...opinionLikeFacts.filter((item) => !existing.has(`${item.statement}\u0000${item.sourceQuote}`))
  ];
  const overflow = combinedOpinions.length > 40;
  const classificationWarning = "Review department and topic classifications.";
  const missingContext = [
    ...extraction.missingContext,
    ...(removedUnquotedClassifications && !extraction.missingContext.includes(classificationWarning)
      ? [classificationWarning]
      : []),
    ...(overflow && !extraction.missingContext.includes("Some subjective statements require manual review.")
      ? ["Some subjective statements require manual review."]
      : [])
  ].slice(0, 30);

  return {
    ...extraction,
    departments,
    topics,
    explicitFacts: extraction.explicitFacts.filter((fact) => !opinionLikeFacts.includes(fact)),
    opinionsOrAssumptions: combinedOpinions.slice(0, 40),
    missingContext
  };
}

export function businessNoteReviewWarnings(extraction: BusinessNoteExtraction): BusinessNoteReviewWarning[] {
  const itemConfidences = [
    ...extraction.explicitFacts,
    ...extraction.opinionsOrAssumptions,
    ...extraction.risks,
    ...extraction.opportunities,
    ...extraction.decisions,
    ...extraction.mentionedMetrics
  ].map((item) => item.confidence);
  const warnings: BusinessNoteReviewWarning[] = [];
  const prompts = businessNoteAdditionalContextPrompts(extraction);
  if (extraction.extractionConfidence < 0.7 || itemConfidences.some((value) => value < 0.5)) {
    warnings.push({ code: "low_confidence", label: "Low-confidence classification" });
  }
  if (prompts.some((prompt) => prompt.key === "reporting_period")) {
    warnings.push({ code: "reporting_period_unclear", label: "Reporting period unclear" });
  }
  if (prompts.some((prompt) => prompt.key === "department")) {
    warnings.push({ code: "department_needs_confirmation", label: "Department needs confirmation" });
  }
  return warnings;
}

export function validateBusinessNoteExtraction(value: unknown, originalNote: string): StructuredOutputValidation<BusinessNoteExtraction> {
  const parsed = extractionSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return validationFailure("Business Note extraction did not match the canonical schema.", {
      reasonCode: "schema_field_type_mismatch",
      stage: "canonical_schema",
      expectedField: issue?.path.length ? `$.${issue.path.join(".")}` : "$",
      expectedType: "object",
      observedType: validationValueType(value),
      truncationDetected: false
    });
  }

  const extraction = normalizeUncertainClassifications(parsed.data, originalNote);

  const safety = validateAiGeneratedOutput(extraction as unknown as Json);
  if (!safety.ok) return canonicalFailure("Business Note extraction failed safe-output validation.", "$", "unsafe_generated_output");
  if (REASONING_LEAKAGE.test(JSON.stringify(extraction))) {
    return canonicalFailure("Business Note extraction exposed prohibited reasoning language.", "$", "reasoning_leakage");
  }
  if (!dateValue(extraction.reportingPeriod.start) || !dateValue(extraction.reportingPeriod.end)) {
    return canonicalFailure("Reporting-period values must be valid ISO dates.", "$.reportingPeriod", "contextual_inconsistency");
  }
  if (extraction.reportingPeriod.start && extraction.reportingPeriod.end && extraction.reportingPeriod.start > extraction.reportingPeriod.end) {
    return canonicalFailure("The reporting-period start must not be after its end.", "$.reportingPeriod", "contextual_inconsistency");
  }
  if ((extraction.reportingPeriod.start || extraction.reportingPeriod.end) && !extraction.reportingPeriod.sourceQuote) {
    return canonicalFailure("A reporting period requires an exact source quotation.", "$.reportingPeriod.sourceQuote", "source_quote_missing");
  }
  if (extraction.reportingPeriod.sourceQuote && !exactQuoteSpan(originalNote, extraction.reportingPeriod.sourceQuote)) {
    return canonicalFailure("The reporting-period quotation does not exist in the original note.", "$.reportingPeriod.sourceQuote", "source_quote_not_found");
  }

  for (const entry of listEntries(extraction)) {
    if (!exactQuoteSpan(originalNote, entry.quote)) {
      return canonicalFailure("An extracted item does not retain an exact quotation from the original note.", `$.${entry.path}.sourceQuote`, "source_quote_not_found");
    }
    if (!statementSupportedByQuote(entry.text, entry.quote)) {
      return canonicalFailure("An extracted item adds meaning or numbers not supported by its source quotation.", `$.${entry.path}`, "unsupported_inference");
    }
  }
  for (const metric of extraction.mentionedMetrics) {
    if (metric.value !== null) {
      const expected = String(metric.value).replace(/,/g, "");
      if (!numericTokens(metric.sourceQuote).some((token) => token.replace(/[^\d.+-]/g, "") === expected)) {
        return canonicalFailure("A metric value is not present in its exact source quotation.", "$.mentionedMetrics", "numeric_integrity_failed", "numeric_integrity");
      }
    }
  }
  if (numericTokens(extraction.summary).some((number) => !new Set(numericTokens(originalNote)).has(number))) {
    return canonicalFailure("The extraction summary introduces a quantity not present in the note.", "$.summary", "numeric_integrity_failed", "numeric_integrity");
  }
  if (!statementSupportedByQuote(extraction.summary, originalNote)) {
    return canonicalFailure("The extraction summary adds meaning not supported by the original note.", "$.summary", "unsupported_inference");
  }
  if (extraction.extractionDisposition === "no_business_context" && listEntries(extraction).length > 0) {
    return canonicalFailure("A no-business-context result cannot include extracted evidence items.", "$.extractionDisposition", "contextual_inconsistency");
  }

  return { ok: true, value: extraction };
}

export function businessNoteSourceSpans(extraction: BusinessNoteExtraction, originalNote: string): BusinessNoteSourceSpan[] {
  const spans = listEntries(extraction).flatMap((entry) => {
    const span = exactQuoteSpan(originalNote, entry.quote);
    return span ? [{ path: entry.path, quote: entry.quote, ...span }] : [];
  });
  if (extraction.reportingPeriod.sourceQuote) {
    const span = exactQuoteSpan(originalNote, extraction.reportingPeriod.sourceQuote);
    if (span) spans.push({ path: "reportingPeriod", quote: extraction.reportingPeriod.sourceQuote, ...span });
  }
  for (const [collection, values] of [["departments", extraction.departments], ["topics", extraction.topics]] as const) {
    values.forEach((value, index) => {
      const start = originalNote.toLowerCase().indexOf(value.toLowerCase());
      if (start >= 0) spans.push({ path: `${collection}.${index}`, quote: originalNote.slice(start, start + value.length), start, end: start + value.length });
    });
  }
  return spans;
}

const REMOVABLE_COLLECTIONS = new Set([
  "peopleMentioned",
  "customersMentioned",
  "vendorsMentioned",
  "projectsMentioned",
  "explicitFacts",
  "opinionsOrAssumptions",
  "risks",
  "opportunities",
  "decisions",
  "mentionedMetrics"
]);

export function applyBusinessNoteReviewCorrections(
  extraction: BusinessNoteExtraction,
  corrections: BusinessNoteReviewCorrections
): BusinessNoteExtraction {
  const removed = new Set(corrections.removedItemPaths);
  const filter = <T,>(collection: string, values: readonly T[]) => values.filter((_, index) => !removed.has(`${collection}.${index}`));
  const safeRemoved = Array.from(removed).every((path) => {
    const [collection, index] = path.split(".");
    return REMOVABLE_COLLECTIONS.has(collection) && /^\d+$/.test(index || "");
  });
  if (!safeRemoved) throw new Error("The Business Note review contained an invalid item selection.");

  return {
    ...extraction,
    title: corrections.title.trim(),
    noteType: corrections.noteType,
    departments: corrections.departments,
    topics: corrections.topics,
    reportingPeriod: {
      start: corrections.reportingPeriod.start,
      end: corrections.reportingPeriod.end,
      inferred: false,
      sourceQuote: extraction.reportingPeriod.sourceQuote
    },
    peopleMentioned: filter("peopleMentioned", extraction.peopleMentioned),
    customersMentioned: filter("customersMentioned", extraction.customersMentioned),
    vendorsMentioned: filter("vendorsMentioned", extraction.vendorsMentioned),
    projectsMentioned: filter("projectsMentioned", extraction.projectsMentioned),
    explicitFacts: filter("explicitFacts", extraction.explicitFacts),
    opinionsOrAssumptions: filter("opinionsOrAssumptions", extraction.opinionsOrAssumptions),
    risks: filter("risks", extraction.risks),
    opportunities: filter("opportunities", extraction.opportunities),
    decisions: filter("decisions", extraction.decisions),
    mentionedMetrics: filter("mentionedMetrics", extraction.mentionedMetrics)
  };
}
