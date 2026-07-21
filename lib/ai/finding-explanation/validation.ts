import "server-only";

import { z } from "zod";
import type {
  FindingExplanationModelOutput,
  FindingExplanationPackage
} from "@/lib/ai/finding-explanation/contracts";
import type { StructuredOutputValidation } from "@/lib/ai/providers/provider-manager";
import { validationFailure, validationValueType } from "@/lib/ai/validation-diagnostics";
import { validateAiGeneratedOutput } from "@/lib/security/ai-output-validation";
import type { Json } from "@/lib/supabase/types";

const outputSchema = z.object({
  what_happened: z.string().trim().min(25).max(520),
  why_evidence_suggests: z.string().trim().min(25).max(620),
  why_leadership_should_care: z.string().trim().min(25).max(520),
  investigate_next: z.string().trim().min(20).max(520),
  what_evidence_does_not_prove: z.string().trim().min(20).max(420)
}).strict();

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const CITATION_PATTERN = /\[\s*\d+\s*\]/;
const INTERNAL_IDENTIFIER_PATTERN = /\b(?:source_file_id|workspace_id|import_id|candidate_id|manifest_id|signal_id|raw_data_json)\b/i;
const REASONING_LEAKAGE_PATTERN = /\b(?:chain of thought|hidden reasoning|internal reasoning|system prompt|step-by-step reasoning)\b|<\/?think>/i;
const ASSERTIVE_CAUSATION_PATTERN = /\b(?:caused?\s+(?:by|the|a|an|this|that)|results? in|leads? to|drives?\b|proves?|guarantees?|forecasts?|predicts?|will (?:cause|create|produce))\b/i;
const CONSULTANT_JARGON_PATTERN = /\b(?:operational pressure|execution quality|growth quality|cross-functional deterioration|strategic headwinds|isolated indicators|operational constraints|leverage synergies|north star|move the needle)\b/i;
const PLACEHOLDER_PATTERN = /\b(?:idk|tbd|placeholder|lorem ipsum)\b/i;
const STOP_WORDS = new Set([
  "about", "after", "again", "because", "business", "current", "evidence", "finding", "from",
  "into", "leadership", "more", "next", "should", "that", "their", "these", "this", "those",
  "through", "under", "what", "when", "where", "which", "with", "without"
]);

const OUTPUT_FIELDS = [
  "what_happened",
  "why_evidence_suggests",
  "why_leadership_should_care",
  "investigate_next",
  "what_evidence_does_not_prove"
] as const;

function combinedText(output: FindingExplanationModelOutput) {
  return OUTPUT_FIELDS.map((field) => output[field]).join(" ");
}

function fieldWithMatch(output: FindingExplanationModelOutput, pattern: RegExp) {
  return OUTPUT_FIELDS.find((field) => {
    pattern.lastIndex = 0;
    return pattern.test(output[field]);
  }) || "$";
}

function terms(value: string) {
  return Array.from(new Set(value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length >= 4 && !STOP_WORDS.has(term))));
}

function groundedIn(output: string, approved: string) {
  const approvedTerms = terms(approved);
  if (!approvedTerms.length) return true;
  const outputTerms = new Set(terms(output));
  return approvedTerms.some((term) => outputTerms.has(term));
}

function numericClaims(value: string) {
  return value.match(/(?<![A-Za-z0-9])-?\$?\d[\d,]*(?:\.\d+)?%?/g) || [];
}

function normalizeNumber(value: string) {
  return value.replace(/[$,%\s]/g, "").replace(/^\+/, "");
}

export function validateFindingExplanationOutput(
  value: unknown,
  context: FindingExplanationPackage
): StructuredOutputValidation<FindingExplanationModelOutput> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return validationFailure("The finding explanation must be one JSON object.", {
      reasonCode: "root_not_object",
      stage: "canonical_schema",
      expectedField: "$",
      expectedType: "object",
      observedType: validationValueType(value)
    });
  }
  const parsed = outputSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.length ? issue.path.join(".") : "$";
    const observed = issue?.path.reduce<unknown>((current, key) => {
      if (!current || typeof current !== "object") return undefined;
      return (current as Record<string | number, unknown>)[key];
    }, value);
    return validationFailure("The finding explanation did not match its fixed contract.", {
      reasonCode: "schema_field_type_mismatch",
      stage: "canonical_schema",
      expectedField: field,
      expectedType: "string",
      observedType: validationValueType(observed),
      fieldPresent: observed !== undefined
    });
  }

  const output = parsed.data;
  const text = combinedText(output);
  if (UUID_PATTERN.test(text) || CITATION_PATTERN.test(text) || INTERNAL_IDENTIFIER_PATTERN.test(text)) {
    return validationFailure("The provider must not generate identifiers or citations.", {
      reasonCode: "invalid_citation_id",
      stage: "citation_provenance",
      expectedField: fieldWithMatch(output, UUID_PATTERN.test(text) ? UUID_PATTERN : INTERNAL_IDENTIFIER_PATTERN),
      expectedType: "string",
      observedType: "string"
    });
  }
  if (REASONING_LEAKAGE_PATTERN.test(text) || CONSULTANT_JARGON_PATTERN.test(text) || PLACEHOLDER_PATTERN.test(text)) {
    const pattern = REASONING_LEAKAGE_PATTERN.test(text)
      ? REASONING_LEAKAGE_PATTERN
      : CONSULTANT_JARGON_PATTERN.test(text)
        ? CONSULTANT_JARGON_PATTERN
        : PLACEHOLDER_PATTERN;
    return validationFailure("The response exposed disallowed language.", {
      reasonCode: "contextual_validation_failed",
      stage: "contextual_validation",
      expectedField: fieldWithMatch(output, pattern),
      expectedType: "string",
      observedType: "string"
    });
  }
  if (ASSERTIVE_CAUSATION_PATTERN.test(text)) {
    return validationFailure("The response asserted a cause or outcome that the evidence does not establish.", {
      reasonCode: "unsupported_inference",
      stage: "contextual_validation",
      expectedField: fieldWithMatch(output, ASSERTIVE_CAUSATION_PATTERN),
      expectedType: "string",
      observedType: "string"
    });
  }

  const approvedNumbers = new Set(numericClaims(JSON.stringify(context.facts)).map(normalizeNumber));
  const unsupportedNumber = numericClaims(text).find((claim) => !approvedNumbers.has(normalizeNumber(claim)));
  if (unsupportedNumber) {
    return validationFailure("The response introduced a number outside the approved facts.", {
      reasonCode: "numeric_integrity_failed",
      stage: "numeric_integrity",
      expectedField: OUTPUT_FIELDS.find((field) => numericClaims(output[field]).some((claim) => !approvedNumbers.has(normalizeNumber(claim)))) || "$",
      expectedType: "string",
      observedType: "string"
    });
  }

  const groundingChecks: Array<[keyof FindingExplanationModelOutput, string]> = [
    ["what_happened", `${context.facts.title} ${context.facts.approvedDevelopment}`],
    ["why_evidence_suggests", context.facts.approvedEvidenceBasis],
    ["why_leadership_should_care", context.facts.approvedLeadershipRelevance],
    ["investigate_next", context.facts.approvedInvestigationNext],
    ["what_evidence_does_not_prove", context.facts.approvedLimitations.join(" ")]
  ];
  const ungrounded = groundingChecks.find(([field, approved]) => !groundedIn(output[field], approved));
  if (ungrounded) {
    return validationFailure("The response moved beyond the application-approved finding boundary.", {
      reasonCode: "unsupported_inference",
      stage: "contextual_validation",
      expectedField: ungrounded[0],
      expectedType: "string",
      observedType: "string"
    });
  }

  const securityValidation = validateAiGeneratedOutput(output as unknown as Json);
  if (!securityValidation.ok) {
    return validationFailure("The response failed shared output safety validation.", {
      reasonCode: "contextual_validation_failed",
      stage: "contextual_validation",
      expectedField: "$",
      expectedType: "object",
      observedType: "object"
    });
  }
  return { ok: true, value: output };
}
