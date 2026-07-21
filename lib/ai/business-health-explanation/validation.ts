import "server-only";

import { z } from "zod";
import type {
  BusinessHealthExplanationModelOutput,
  BusinessHealthExplanationPackage
} from "@/lib/ai/business-health-explanation/contracts";
import { validateAiGeneratedOutput } from "@/lib/security/ai-output-validation";
import type { StructuredOutputValidation } from "@/lib/ai/providers/provider-manager";
import { validationFailure, validationValueType } from "@/lib/ai/validation-diagnostics";
import type { Json } from "@/lib/supabase/types";

const outputSchema = z.object({
  executive_interpretation: z.string().trim().min(30).max(700),
  why_it_matters: z.string().trim().min(20).max(420),
  leadership_consideration: z.string().trim().min(20).max(420),
  provisional_hypothesis: z.string().trim().min(20).max(420).nullable()
}).strict();

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const CITATION_PATTERN = /\[\s*\d+\s*\]/;
const REASONING_LEAKAGE_PATTERN = /\b(?:chain of thought|hidden reasoning|internal reasoning|system prompt|step-by-step reasoning)\b|<\/?think>/i;
const UNSUPPORTED_CAUSATION_PATTERN = /\b(?:caused? by|results? in|leads? to|will (?:cause|create|produce)|because of)\b/i;
const STOP_WORDS = new Set(["business", "health", "current", "target", "recorded", "latest", "period", "remained", "requires", "review", "below", "above", "declined", "increased", "improved", "worsened"]);

function combinedText(output: BusinessHealthExplanationModelOutput) {
  return [
    output.executive_interpretation,
    output.why_it_matters,
    output.leadership_consideration,
    output.provisional_hypothesis || ""
  ].join(" ");
}

function numericClaims(value: string) {
  return value.match(/(?<![A-Za-z0-9])-?\$?\d[\d,]*(?:\.\d+)?%?/g) || [];
}

function normalizeNumber(value: string) {
  return value.replace(/[$,%\s]/g, "").replace(/^\+/, "");
}

function driverTerms(label: string) {
  return Array.from(new Set(
    label
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((term) => term.length >= 4 && !STOP_WORDS.has(term))
  )).slice(0, 4);
}

export function validateBusinessHealthExplanationOutput(
  value: unknown,
  context: BusinessHealthExplanationPackage
): StructuredOutputValidation<BusinessHealthExplanationModelOutput> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return validationFailure("The Business Health response must be one JSON object.", {
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
    return validationFailure("The Business Health response did not match its fixed output contract.", {
      reasonCode: "schema_field_type_mismatch",
      stage: "canonical_schema",
      expectedField: field,
      observedType: validationValueType(observed),
      fieldPresent: observed !== undefined
    });
  }

  const output = parsed.data;
  const text = combinedText(output);
  if (UUID_PATTERN.test(text) || CITATION_PATTERN.test(text)) {
    return validationFailure("The provider must not generate record identifiers or citation IDs.", {
      reasonCode: "invalid_citation_id",
      stage: "citation_provenance",
      expectedField: "$",
      expectedType: "string",
      observedType: "string"
    });
  }
  if (REASONING_LEAKAGE_PATTERN.test(text)) {
    return validationFailure("The response exposed internal reasoning or instructions.", {
      reasonCode: "contextual_validation_failed",
      stage: "contextual_validation",
      expectedField: "$",
      expectedType: "string",
      observedType: "string"
    });
  }
  if (!context.hypothesisAllowed && output.provisional_hypothesis !== null) {
    return validationFailure("A provisional hypothesis was not authorized by the deterministic contract.", {
      reasonCode: "unsupported_relationship",
      stage: "relationship_support",
      expectedField: "provisional_hypothesis",
      expectedType: "null",
      observedType: "string"
    });
  }
  if (!context.hypothesisAllowed && UNSUPPORTED_CAUSATION_PATTERN.test(text)) {
    return validationFailure("The response introduced an unsupported causal relationship.", {
      reasonCode: "unsupported_relationship",
      stage: "relationship_support",
      expectedField: "$",
      expectedType: "string",
      observedType: "string"
    });
  }

  const approvedFactText = JSON.stringify({
    score: context.facts.score,
    comparisonDelta: context.facts.comparisonDelta,
    dataQualityBase: context.facts.dataQualityBase,
    riskPenalty: context.facts.riskPenalty,
    opportunityAdjustment: context.facts.opportunityAdjustment,
    drivers: context.facts.drivers.map((driver) => ({
      scoreImpact: driver.scoreImpact,
      fact: driver.fact
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

  const normalizedText = text.toLowerCase();
  const requiredDrivers = context.facts.drivers.slice(0, 3);
  const missingDrivers = requiredDrivers.filter((driver) => {
    const terms = driverTerms(driver.label);
    return terms.length > 0 && !terms.some((term) => normalizedText.includes(term));
  });
  if (missingDrivers.length) {
    return validationFailure("The explanation did not cover every required top Business Health driver.", {
      reasonCode: "missing_required_signal",
      stage: "ranked_signal_coverage",
      expectedField: "$",
      expectedType: "string",
      observedType: "string",
      expectedCount: requiredDrivers.length,
      observedCount: requiredDrivers.length - missingDrivers.length
    });
  }

  const securityValidation = validateAiGeneratedOutput(output as unknown as Json);
  if (!securityValidation.ok) {
    return validationFailure("The response failed the shared generated-output safety validation.", {
      reasonCode: "contextual_validation_failed",
      stage: "contextual_validation",
      expectedField: "$",
      expectedType: "object",
      observedType: "object"
    });
  }

  return { ok: true, value: output };
}
