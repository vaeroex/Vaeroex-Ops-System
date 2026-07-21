import "server-only";

import { z } from "zod";
import type {
  ExecutiveBriefModelOutput,
  ExecutiveBriefPackage,
  ExecutiveBriefSignal
} from "@/lib/ai/executive-brief/contracts";
import type { StructuredOutputValidation } from "@/lib/ai/providers/provider-manager";
import { validationFailure, validationValueType } from "@/lib/ai/validation-diagnostics";
import { validateAiGeneratedOutput } from "@/lib/security/ai-output-validation";
import type { Json } from "@/lib/supabase/types";

const outputSchema = z.object({
  executive_summary: z.string().trim().min(40).max(1_000),
  why_it_matters: z.string().trim().min(25).max(520),
  primary_concern: z.string().trim().min(20).max(520).nullable(),
  positive_signal: z.string().trim().min(20).max(520).nullable(),
  leadership_focus: z.string().trim().min(25).max(620),
  uncertainty: z.string().trim().min(15).max(420),
  provisional_hypothesis: z.string().trim().min(20).max(420).nullable()
}).strict();

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const CITATION_PATTERN = /\[\s*\d+\s*\]/;
const INTERNAL_IDENTIFIER_PATTERN = /\b(?:source_file_id|workspace_id|import_id|candidate_id|manifest_id|signal_id|raw_data_json)\b/i;
const REASONING_LEAKAGE_PATTERN = /\b(?:chain of thought|hidden reasoning|internal reasoning|system prompt|step-by-step reasoning)\b|<\/?think>/i;
const CAUSATION_OR_FORECAST_PATTERN = /\b(?:caused? by|results? in|leads? to|drives?\b|will (?:cause|create|produce)|guarantees?|proves?|forecasts?|predicts?)\b/i;
const RELATIONSHIP_PATTERN = /\b(?:correlat(?:e|ed|ion)|associated? with|linked? to|co-mov(?:e|ement)|moves? with)\b/i;
const UNSUPPORTED_ACTION_PATTERN = /\b(?:hire|fire|lay off|acquire|sell|launch|expand|close|invest|borrow|raise prices?|cut prices?|increase budget|reduce headcount)\b/i;

function combinedText(output: ExecutiveBriefModelOutput) {
  return [
    output.executive_summary,
    output.why_it_matters,
    output.primary_concern || "",
    output.positive_signal || "",
    output.leadership_focus,
    output.uncertainty,
    output.provisional_hypothesis || ""
  ].join(" ");
}

const OUTPUT_FIELDS = [
  "executive_summary",
  "why_it_matters",
  "primary_concern",
  "positive_signal",
  "leadership_focus",
  "uncertainty",
  "provisional_hypothesis"
] as const;

function fieldWithMatch(output: ExecutiveBriefModelOutput, pattern: RegExp) {
  return OUTPUT_FIELDS.find((field) => {
    const value = output[field];
    pattern.lastIndex = 0;
    return typeof value === "string" && pattern.test(value);
  }) || "$";
}

function numericClaims(value: string) {
  return value.match(/(?<![A-Za-z0-9])-?\$?\d[\d,]*(?:\.\d+)?%?/g) || [];
}

function normalizeNumber(value: string) {
  return value.replace(/[$,%\s]/g, "").replace(/^\+/, "");
}

function signalCovered(value: string, signal: ExecutiveBriefSignal) {
  const normalized = value.toLowerCase();
  const terms = signal.coverageTerms.filter((term) => term.length >= 4);
  if (terms.length) return terms.some((term) => normalized.includes(term.toLowerCase()));
  const fallback = signal.label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .find((term) => term.length >= 5);
  return fallback ? normalized.includes(fallback) : true;
}

function allowedRelationshipCovered(text: string, context: ExecutiveBriefPackage) {
  if (!RELATIONSHIP_PATTERN.test(text)) return true;
  if (!context.permittedRelationships.length) return false;
  const normalized = text.toLowerCase();
  return context.permittedRelationships.some((relationship) => {
    const signals = relationship.signalOrdinals
      .map((ordinal) => context.signals.find((signal) => signal.ordinal === ordinal))
      .filter((signal): signal is ExecutiveBriefSignal => Boolean(signal));
    return signals.length === 2 && signals.every((signal) => signalCovered(normalized, signal));
  });
}

function hypothesisSupported(value: string, context: ExecutiveBriefPackage) {
  if (!context.permittedHypothesis) return false;
  const permittedTerms = context.permittedHypothesis
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length >= 5);
  const normalized = value.toLowerCase();
  return permittedTerms.length > 0 && permittedTerms.filter((term) => normalized.includes(term)).length >= Math.min(2, permittedTerms.length);
}

function uncertaintyMatchesState(value: string, context: ExecutiveBriefPackage) {
  if (context.submode === "evidence_stale") return /\b(?:stale|dated|older|recent|current)\b/i.test(value);
  if (context.submode === "evidence_sparse" || context.submode === "insufficient_evidence") {
    return /\b(?:limited|insufficient|sparse|coverage|source|history)\b/i.test(value);
  }
  if (context.submode === "conflicting_evidence") return /\b(?:mixed|conflict|differ|diverg|uncertain)\b/i.test(value);
  return true;
}

export function validateExecutiveBriefOutput(
  value: unknown,
  context: ExecutiveBriefPackage
): StructuredOutputValidation<ExecutiveBriefModelOutput> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return validationFailure("The Executive Brief response must be one JSON object.", {
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
    const observedType = validationValueType(observed);
    const lengthMismatch = observedType === "string" && (issue?.code === "too_small" || issue?.code === "too_big");
    return validationFailure("The Executive Brief response did not match its fixed output contract.", {
      reasonCode: field === "executive_summary"
        ? "executive_summary_missing"
        : field === "uncertainty" && lengthMismatch
          ? "uncertainty_invalid"
          : "schema_field_type_mismatch",
      stage: "canonical_schema",
      expectedField: field,
      expectedType: "string",
      observedType,
      expectedCount: issue?.code === "too_small" || issue?.code === "too_big" ? Number(issue.minimum ?? issue.maximum) : undefined,
      observedCount: typeof observed === "string" ? observed.length : undefined,
      fieldPresent: observed !== undefined
    });
  }

  const output = parsed.data;
  const text = combinedText(output);
  if (UUID_PATTERN.test(text) || CITATION_PATTERN.test(text) || INTERNAL_IDENTIFIER_PATTERN.test(text)) {
    return validationFailure("The provider must not generate internal identifiers or citation IDs.", {
      reasonCode: "invalid_citation_id",
      stage: "citation_provenance",
      expectedField: "$",
      expectedType: "string",
      observedType: "string"
    });
  }
  if (REASONING_LEAKAGE_PATTERN.test(text)) {
    const field = fieldWithMatch(output, REASONING_LEAKAGE_PATTERN);
    return validationFailure("The response exposed internal reasoning or instructions.", {
      reasonCode: "contextual_validation_failed",
      stage: "contextual_validation",
      expectedField: field,
      expectedType: "string",
      observedType: "string"
    });
  }
  if (CAUSATION_OR_FORECAST_PATTERN.test(text)) {
    const field = fieldWithMatch(output, CAUSATION_OR_FORECAST_PATTERN);
    return validationFailure("The response introduced an unsupported cause, forecast, or outcome.", {
      reasonCode: "unsupported_inference",
      stage: "contextual_validation",
      expectedField: field,
      expectedType: "string",
      observedType: "string"
    });
  }
  if (!allowedRelationshipCovered(text, context)) {
    return validationFailure("The response introduced a relationship outside the application-approved set.", {
      reasonCode: "unsupported_relationship",
      stage: "relationship_support",
      expectedField: "$",
      expectedType: "string",
      observedType: "string"
    });
  }
  if (UNSUPPORTED_ACTION_PATTERN.test(output.leadership_focus)) {
    const approvedActions = context.signals
      .flatMap((signal) => signal.approvedLeadershipFocus || [])
      .join(" ");
    if (!UNSUPPORTED_ACTION_PATTERN.test(approvedActions)) {
      return validationFailure("The response introduced a leadership action outside the approved focus.", {
        reasonCode: "invalid_action",
        stage: "contextual_validation",
        expectedField: "leadership_focus",
        expectedType: "string",
        observedType: "string"
      });
    }
  }

  const approvedFactText = JSON.stringify({
    businessHealth: context.facts.businessHealth,
    changes: context.facts.materialChanges,
    signals: context.signals.map((signal) => ({
      fact: signal.approvedFact,
      leadershipFocus: signal.approvedLeadershipFocus
    }))
  });
  const approvedNumbers = new Set(numericClaims(approvedFactText).map(normalizeNumber));
  const unsupportedNumber = numericClaims(text).find((claim) => !approvedNumbers.has(normalizeNumber(claim)));
  if (unsupportedNumber) {
    return validationFailure("The response introduced a number outside the approved deterministic facts.", {
      reasonCode: "numeric_integrity_failed",
      stage: "numeric_integrity",
      expectedField: "$",
      expectedType: "string",
      observedType: "string"
    });
  }

  const requiredSignals = context.signals.filter((signal) => context.requiredSignalOrdinals.includes(signal.ordinal));
  const missingSignals = requiredSignals.filter((signal) => !signalCovered(text, signal));
  if (missingSignals.length) {
    return validationFailure("The brief did not cover every required executive signal.", {
      reasonCode: "missing_required_signal",
      stage: "ranked_signal_coverage",
      expectedField: "$",
      expectedType: "string",
      observedType: "string",
      expectedCount: requiredSignals.length,
      observedCount: requiredSignals.length - missingSignals.length
    });
  }

  const primaryConcern = context.signals.find((signal) => signal.ordinal === context.primaryConcernOrdinal);
  if (primaryConcern && (!output.primary_concern || !signalCovered(output.primary_concern, primaryConcern))) {
    return validationFailure("The required primary concern was omitted or changed.", {
      reasonCode: "missing_required_signal",
      stage: "ranked_signal_coverage",
      expectedField: "primary_concern",
      expectedType: "string",
      observedType: validationValueType(output.primary_concern)
    });
  }
  if (!primaryConcern && output.primary_concern !== null) {
    return validationFailure("The response invented a primary concern.", {
      reasonCode: "unsupported_inference",
      stage: "contextual_validation",
      expectedField: "primary_concern",
      expectedType: "null",
      observedType: "string"
    });
  }

  const positiveSignal = context.signals.find((signal) => signal.ordinal === context.positiveSignalOrdinal);
  if (positiveSignal && (!output.positive_signal || !signalCovered(output.positive_signal, positiveSignal))) {
    return validationFailure("The established positive signal was omitted or changed.", {
      reasonCode: "missing_required_signal",
      stage: "ranked_signal_coverage",
      expectedField: "positive_signal",
      expectedType: "string",
      observedType: validationValueType(output.positive_signal)
    });
  }
  if (!positiveSignal && output.positive_signal !== null) {
    return validationFailure("The response invented a positive signal.", {
      reasonCode: "unsupported_inference",
      stage: "contextual_validation",
      expectedField: "positive_signal",
      expectedType: "null",
      observedType: "string"
    });
  }

  const focusSignals = context.signals.filter((signal) => context.leadershipFocusOrdinals.includes(signal.ordinal));
  if (focusSignals.length && !focusSignals.some((signal) => signalCovered(output.leadership_focus, signal))) {
    return validationFailure("The leadership focus did not remain tied to the application-ranked signal.", {
      reasonCode: "invalid_action",
      stage: "ranked_signal_coverage",
      expectedField: "leadership_focus",
      expectedType: "string",
      observedType: "string"
    });
  }

  if (output.provisional_hypothesis && !hypothesisSupported(output.provisional_hypothesis, context)) {
    return validationFailure("The response introduced an unsupported provisional hypothesis.", {
      reasonCode: "unsupported_relationship",
      stage: "relationship_support",
      expectedField: "provisional_hypothesis",
      expectedType: context.permittedHypothesis ? "string" : "null",
      observedType: "string"
    });
  }
  if (!uncertaintyMatchesState(output.uncertainty, context)) {
    return validationFailure("The uncertainty statement did not preserve the contract's evidence limitation.", {
      reasonCode: "uncertainty_invalid",
      stage: "contextual_validation",
      expectedField: "uncertainty",
      expectedType: "string",
      observedType: "string"
    });
  }

  const securityValidation = validateAiGeneratedOutput(output as unknown as Json);
  if (!securityValidation.ok) {
    return validationFailure("The response failed shared generated-output safety validation.", {
      reasonCode: "contextual_validation_failed",
      stage: "contextual_validation",
      expectedField: "$",
      expectedType: "object",
      observedType: "object"
    });
  }

  return { ok: true, value: output };
}
