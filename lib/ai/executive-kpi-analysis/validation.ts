import "server-only";

import { z } from "zod";
import type {
  ExecutiveKpiAnalysisModelOutput,
  ExecutiveKpiAnalysisPackage
} from "@/lib/ai/executive-kpi-analysis/contracts";
import type { StructuredOutputValidation } from "@/lib/ai/providers/provider-manager";
import { validationFailure, validationValueType } from "@/lib/ai/validation-diagnostics";
import { validateAiGeneratedOutput } from "@/lib/security/ai-output-validation";
import type { Json } from "@/lib/supabase/types";

const relationshipLabel = z.enum([
  "Pattern worth investigating",
  "Possible relationship",
  "Supported correlation",
  "Strong supported relationship",
  "No clear relationship detected"
]);
const outputSchema = z.object({
  executive_summary: z.string().trim().min(30).max(720),
  significant_trends: z.array(z.object({
    metric_ordinals: z.array(z.number().int().positive()).min(1),
    statement: z.string().trim().min(20).max(420)
  }).strict()).min(1).max(3),
  potential_kpi_relationships: z.array(z.object({
    metric_ordinals: z.array(z.number().int().positive()).min(2).max(4),
    status: relationshipLabel,
    statement: z.string().trim().min(20).max(480)
  }).strict()).min(1).max(3),
  possible_business_drivers: z.array(z.object({
    metric_ordinals: z.array(z.number().int().positive()).min(2).max(4),
    statement: z.string().trim().min(20).max(420)
  }).strict()).min(1).max(2),
  leadership_considerations: z.array(z.string().trim().min(20).max(420)).min(1).max(3),
  analysis_limitations: z.array(z.string().trim().min(20).max(420)).min(1).max(3)
}).strict();

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const CITATION_PATTERN = /\[\s*\d+\s*\]/;
const INTERNAL_IDENTIFIER_PATTERN = /\b(?:workspace_id|source_file_id|import_id|raw_data_json|candidate_id|manifest_id|kpi_id)\b/i;
const REASONING_LEAKAGE_PATTERN = /\b(?:chain of thought|hidden reasoning|internal reasoning|system prompt|step-by-step reasoning)\b|<\/?think>/i;
const ASSERTIVE_CAUSATION_PATTERN = /\b(?:caused?\b|results? in|leads? to|drives?\b|proves?|guarantees?|definitely|the business will|will (?:cause|create|produce))\b/i;
const UNSUPPORTED_RELATIONSHIP_PATTERN = /\b(?:(?:are|is|were|was|show(?:s|ed)?|demonstrate(?:s|d)?|indicate(?:s|d)?)\s+(?:strongly\s+)?(?:correlated|statistically significant)|strong supported relationship|confirmed relationship)\b/i;
const INVENTED_KPI_PATTERN = /\b[A-Z][A-Za-z&-]+(?:\s+(?!(?:Rate|Revenue|Margin|Sales|Reviews?|Wait|Time|Score|Volume|Cost|Profit|Inventory|Satisfaction|Response|Basket|Flow)\b)[A-Z][A-Za-z&()/-]+){0,3}\s+(?:Rate|Revenue|Margin|Sales|Reviews?|Wait|Time|Score|Volume|Cost|Profit|Inventory|Satisfaction|Response|Basket|Flow)\b/g;
const PLACEHOLDER_PATTERN = /\b(?:idk|tbd|placeholder|lorem ipsum)\b/i;
const KPI_ORDINAL_REFERENCE_PATTERN = /\bKPI\s+(\d+)\b/gi;
const CONDITIONAL_LANGUAGE_PATTERN = /\b(?:may|might|could|possibly|potential|suggests?|appears?|worth investigating|does not (?:show|prove|confirm|establish))\b/i;
const CERTAINTY_PATTERN = /\b(?:proves?|guarantees?|definitely|the business will|will (?:cause|create|produce))\b/i;
const NEGATED_CERTAINTY_PATTERN = /\b(?:does not|doesn't|cannot|can't|may not|might not|could not|not enough to)\s+(?:prove|guarantee|confirm|establish)\b/i;
const TECHNICAL_CUSTOMER_LANGUAGE_PATTERN = /\b(?:penultimate observation|immutable ordinal|application-owned|observed movement only|contextual validation|underlying driver is not established|correlation, significance, and causation are not established)\b/i;
const LIMITED_DATA_LANGUAGE_PATTERN = /\b(?:limited (?:history|data)|history is limited|fewer than \d+|only \d+ observations?)\b/i;

function combinedText(output: ExecutiveKpiAnalysisModelOutput) {
  return [
    output.executive_summary,
    ...output.significant_trends.map((item) => item.statement),
    ...output.potential_kpi_relationships.map((item) => item.statement),
    ...output.possible_business_drivers.map((item) => item.statement),
    ...output.leadership_considerations,
    ...output.analysis_limitations
  ].join(" ");
}

function numericClaims(value: string) {
  return value.match(/(?<![A-Za-z0-9])-?\$?\d[\d,]*(?:\.\d+)?%?/g) || [];
}

function normalizeNumber(value: string) {
  return value.replace(/[$,%\s]/g, "").replace(/^\+/, "");
}

function uniqueOrdinals(values: readonly number[]) {
  return new Set(values).size === values.length;
}

function sentences(value: string) {
  return value.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
}

function relationshipPairs(ordinals: readonly number[]) {
  const pairs: string[] = [];
  for (let left = 0; left < ordinals.length; left += 1) {
    for (let right = left + 1; right < ordinals.length; right += 1) {
      pairs.push([ordinals[left], ordinals[right]].sort((a, b) => a - b).join(":"));
    }
  }
  return pairs;
}

export function validateExecutiveKpiAnalysisOutput(
  value: unknown,
  context: ExecutiveKpiAnalysisPackage
): StructuredOutputValidation<ExecutiveKpiAnalysisModelOutput> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return validationFailure("The Executive KPI Analysis must be one JSON object.", {
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
    return validationFailure("The Executive KPI Analysis did not match its fixed contract.", {
      reasonCode: "schema_field_type_mismatch",
      stage: "canonical_schema",
      expectedField: issue?.path.length ? issue.path.join(".") : "$",
      observedType: "object"
    });
  }
  const output = parsed.data;
  const text = combinedText(output);
  if (UUID_PATTERN.test(text) || CITATION_PATTERN.test(text) || INTERNAL_IDENTIFIER_PATTERN.test(text)) {
    return validationFailure("The provider must not generate identifiers or citations.", {
      reasonCode: "invalid_citation_id",
      stage: "citation_provenance",
      expectedField: "$",
      expectedType: "string",
      observedType: "string"
    });
  }
  if (REASONING_LEAKAGE_PATTERN.test(text) || PLACEHOLDER_PATTERN.test(text) || TECHNICAL_CUSTOMER_LANGUAGE_PATTERN.test(text)) {
    return validationFailure("The response exposed disallowed internal or placeholder language.", {
      reasonCode: "contextual_validation_failed",
      stage: "contextual_validation",
      expectedField: "$",
      expectedType: "string",
      observedType: "string"
    });
  }
  const unsupportedCausation = sentences(text).find((sentence) => (
    (CERTAINTY_PATTERN.test(sentence) && !NEGATED_CERTAINTY_PATTERN.test(sentence))
    || (ASSERTIVE_CAUSATION_PATTERN.test(sentence) && !CONDITIONAL_LANGUAGE_PATTERN.test(sentence))
  ));
  if (unsupportedCausation) {
    return validationFailure("The response asserted causation or certainty that the KPI package does not establish.", {
      reasonCode: "unsupported_inference",
      stage: "contextual_validation",
      expectedField: "$",
      expectedType: "string",
      observedType: "string"
    });
  }
  if (UNSUPPORTED_RELATIONSHIP_PATTERN.test(text)) {
    return validationFailure("The response upgraded observed movement into an unsupported statistical relationship.", {
      reasonCode: "unsupported_relationship",
      stage: "relationship_support",
      expectedField: "$",
      expectedType: "string",
      observedType: "string"
    });
  }
  const repeatedRelationshipCaveats = sentences(text).filter((sentence) => (
    /\b(?:correlat|caus)/i.test(sentence)
    && /\b(?:not|cannot|insufficient|limited|without|does not)\b/i.test(sentence)
  ));
  if (repeatedRelationshipCaveats.length > 1) {
    return validationFailure("The response repeated the same relationship limitation across sections.", {
      reasonCode: "contextual_validation_failed",
      stage: "contextual_validation",
      expectedField: "$",
      expectedType: "string",
      observedType: "string"
    });
  }
  const repeatedLimitedData = sentences(text).filter((sentence) => LIMITED_DATA_LANGUAGE_PATTERN.test(sentence));
  if (repeatedLimitedData.length > 1) {
    return validationFailure("The response repeated the same limited-data disclosure across sections.", {
      reasonCode: "contextual_validation_failed",
      stage: "contextual_validation",
      expectedField: "$",
      expectedType: "string",
      observedType: "string"
    });
  }
  const allowedOrdinals = new Set(context.facts.metrics.map((metric) => metric.ordinal));
  const proseOrdinals = Array.from(text.matchAll(KPI_ORDINAL_REFERENCE_PATTERN), (match) => Number(match[1]));
  if (proseOrdinals.some((ordinal) => !allowedOrdinals.has(ordinal))) {
    return validationFailure("The response referenced a KPI outside the immutable package.", {
      reasonCode: "unknown_signal_id",
      stage: "ranked_signal_coverage",
      expectedField: "$",
      expectedType: "string",
      observedType: "string"
    });
  }
  const knownMetricNames = new Set(context.facts.metrics.map((metric) => metric.name.toLowerCase()));
  const inventedMetricName = Array.from(text.matchAll(INVENTED_KPI_PATTERN), (match) => match[0])
    .find((name) => !knownMetricNames.has(name.toLowerCase()));
  if (inventedMetricName) {
    return validationFailure("The response introduced a KPI name outside the immutable package.", {
      reasonCode: "unknown_signal_id",
      stage: "ranked_signal_coverage",
      expectedField: "$",
      expectedType: "string",
      observedType: "string"
    });
  }

  const referenced = [
    ...output.significant_trends.map((item) => item.metric_ordinals),
    ...output.potential_kpi_relationships.map((item) => item.metric_ordinals),
    ...output.possible_business_drivers.map((item) => item.metric_ordinals)
  ];
  if (referenced.some((ordinals) => !uniqueOrdinals(ordinals) || ordinals.some((ordinal) => !allowedOrdinals.has(ordinal)))) {
    return validationFailure("The response referenced a KPI outside the immutable package.", {
      reasonCode: "unknown_signal_id",
      stage: "ranked_signal_coverage",
      expectedField: "metric_ordinals",
      expectedType: "array",
      observedType: "array"
    });
  }

  const relationshipByPair = new Map(context.facts.relationships.map((relationship) => [
    [relationship.leftOrdinal, relationship.rightOrdinal].sort((a, b) => a - b).join(":"),
    relationship
  ]));
  for (const relationship of output.potential_kpi_relationships) {
    const approved = relationshipPairs(relationship.metric_ordinals)
      .map((pair) => relationshipByPair.get(pair));
    if (approved.some((candidate) => !candidate)) {
      return validationFailure("The response introduced a relationship outside the deterministic package.", {
        reasonCode: "invalid_relationship",
        stage: "relationship_support",
        expectedField: "potential_kpi_relationships.metric_ordinals",
        expectedType: "array",
        observedType: "array"
      });
    }
    const approvedStatuses = new Set(approved.map((candidate) => candidate?.status));
    const allowedLabels = approvedStatuses.size === 1 && approvedStatuses.has("statistically_meaningful")
      ? new Set(["Supported correlation", "Strong supported relationship"])
      : approvedStatuses.size === 1 && approvedStatuses.has("correlated")
        ? new Set(["Supported correlation"])
        : approvedStatuses.has("observed_movement_only")
          ? new Set(["Pattern worth investigating", "Possible relationship"])
          : new Set(["No clear relationship detected"]);
    if (!allowedLabels.has(relationship.status)) {
      return validationFailure("The response overstated the deterministic relationship status.", {
        reasonCode: "unsupported_relationship",
        stage: "relationship_support",
        expectedField: "potential_kpi_relationships.status",
        expectedType: "string",
        observedType: "string"
      });
    }
    if (["Pattern worth investigating", "Possible relationship"].includes(relationship.status)
      && !CONDITIONAL_LANGUAGE_PATTERN.test(relationship.statement)) {
      return validationFailure("A possible KPI relationship must remain conditional.", {
        reasonCode: "unsupported_relationship",
        stage: "relationship_support",
        expectedField: "potential_kpi_relationships.statement",
        expectedType: "string",
        observedType: "string"
      });
    }
  }

  for (const driver of output.possible_business_drivers) {
    if (!CONDITIONAL_LANGUAGE_PATTERN.test(driver.statement)) {
      return validationFailure("A possible business driver must remain explicitly conditional.", {
        reasonCode: "unsupported_inference",
        stage: "contextual_validation",
        expectedField: "possible_business_drivers.statement",
        expectedType: "string",
        observedType: "string"
      });
    }
  }

  const approvedNumbers = new Set(numericClaims(JSON.stringify(context.facts)).map(normalizeNumber));
  const unsupportedNumber = numericClaims(text).find((claim) => !approvedNumbers.has(normalizeNumber(claim)));
  if (unsupportedNumber) {
    return validationFailure("The response introduced a number outside the deterministic KPI package.", {
      reasonCode: "numeric_integrity_failed",
      stage: "numeric_integrity",
      expectedField: "$",
      expectedType: "string",
      observedType: "string"
    });
  }

  const requiredOrdinals = context.facts.metrics
    .filter((metric) => metric.percentageChange !== null)
    .sort((left, right) => Math.abs(right.percentageChange || 0) - Math.abs(left.percentageChange || 0))
    .slice(0, 3)
    .map((metric) => metric.ordinal);
  const coveredOrdinals = new Set(output.significant_trends.flatMap((item) => item.metric_ordinals));
  if (requiredOrdinals.some((ordinal) => !coveredOrdinals.has(ordinal))) {
    return validationFailure("The response omitted a required KPI trend.", {
      reasonCode: "missing_required_signal",
      stage: "ranked_signal_coverage",
      expectedField: "significant_trends",
      expectedType: "array",
      observedType: "array",
      expectedCount: requiredOrdinals.length,
      observedCount: requiredOrdinals.filter((ordinal) => coveredOrdinals.has(ordinal)).length
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
