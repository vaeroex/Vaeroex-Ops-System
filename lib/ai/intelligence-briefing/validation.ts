import "server-only";

import {
  INTELLIGENCE_BRIEFING_SECTION_IDS,
  type IntelligenceBriefingClaim,
  type IntelligenceBriefingModelOutput,
  type IntelligenceBriefingPackage,
  type IntelligenceBriefingSignal
} from "@/lib/ai/intelligence-briefing/contracts";
import { INTELLIGENCE_BRIEFING_MODEL_OUTPUT_SCHEMA } from "@/lib/ai/intelligence-briefing/model-output-contract";
import {
  intelligenceBriefingNumericTokens,
  intelligenceBriefingPeriodNumericTokens
} from "@/lib/ai/intelligence-briefing/numeric-integrity";
import type { StructuredOutputValidation } from "@/lib/ai/providers/provider-manager";
import {
  validationFailure,
  validationValueType,
  type AIValidationReasonCode,
  type AIValidationStage,
  type SafeAIValidationDiagnostic
} from "@/lib/ai/validation-diagnostics";
import { validateAiGeneratedOutput } from "@/lib/security/ai-output-validation";
import type { Json } from "@/lib/supabase/types";

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const INTERNAL_IDENTIFIER_PATTERN = /\b(?:workspace_id|source_file_id|candidate_id|manifest_id|raw_data_json|input_json|output_json)\b/i;
const REASONING_PATTERN = /\b(?:chain of thought|hidden reasoning|internal reasoning|system prompt|step-by-step reasoning)\b|<\/?think>/i;
const PREDICTION_CERTAINTY_PATTERN = /\b(?:will definitely|guaranteed|certain to|without doubt|inevitably)\b/i;
const TASK_PATTERN = /\b(?:assign(?:ed)? to|owner\s*:|due date|deadline|create a task|project plan|work item|to-do)\b/i;
const HIGH_RISK_ACTION_PATTERN = /\b(?:hire|fire|lay off|acquire|sell the company|borrow|increase budget|reduce headcount)\b/i;
const CONTEXT_ATTRIBUTION_PATTERN = /\b(?:approved business note|business note reports?|business (?:noted|reports?)|leadership reported|reported context|the note reports?)\b/i;
const CONTEXT_BOUNDARY_PATTERN = /\b(?:does not establish causation|may provide context|could be relevant|reported context|not independently measured)\b/i;
type RelationshipCategory = NonNullable<SafeAIValidationDiagnostic["relationshipCategory"]>;
const RELATIONSHIP_PATTERNS: ReadonlyArray<readonly [Exclude<RelationshipCategory, "context_attribution">, RegExp]> = [
  ["causal", /\b(?:cause(?:d|s)?|because of|results? in|leads? to|drives?|drove|driven|due to|therefore|consequently|proves?)\b/i],
  ["explanatory", /\b(?:explain(?:s|ed|ing)?|attribut(?:e|ed|able) to|accounts? for|reason for)\b/i],
  ["correlational", /\b(?:correlat(?:e|es|ed|ion)|associated with|linked to|tracks? with|relationship between)\b/i],
  ["comparative", /\b(?:compared (?:to|with)|versus|vs\.?|higher than|lower than|greater than|less than|above target|below target)\b/i],
  ["offsetting", /\b(?:offset(?:s|ting)?|counterbalance(?:s|d)?|compensat(?:e|es|ed) for)\b/i],
  ["directional_effect", /\b(?:improv(?:e|es|ed|ing)|worsen(?:s|ed|ing)|boost(?:s|ed|ing)|reduce(?:s|d|ing))\s+(?:the\s+)?(?:metric|performance|result|outcome|margin|revenue|cost|sales)\b/i]
];
const DIRECTION_PAIRS = [
  ["above target", "below target"],
  ["increased", "decreased"],
  ["improving", "declining"],
  ["favorable", "unfavorable"],
  ["maximize", "minimize"],
  ["met", "missed"]
] as const;

function allClaims(output: IntelligenceBriefingModelOutput) {
  return [
    { sectionId: "executive_summary", claim: output.executive_summary },
    ...output.sections.flatMap((section) => [
      { sectionId: section.section_id, claim: { text: section.summary, support_refs: section.support_refs } satisfies IntelligenceBriefingClaim },
      ...section.claims.map((claim) => ({ sectionId: section.section_id, claim }))
    ]),
    ...output.leadership_considerations.map((claim) => ({ sectionId: "leadership_considerations", claim }))
  ];
}

function contradicts(claim: string, signal: IntelligenceBriefingSignal) {
  const source = signal.fact.toLowerCase();
  const text = claim.toLowerCase();
  return DIRECTION_PAIRS.some(([left, right]) =>
    (source.includes(left) && text.includes(right)) || (source.includes(right) && text.includes(left))
  );
}

function failure(message: string, reasonCode: AIValidationReasonCode, stage: AIValidationStage, field = "$") {
  return validationFailure(message, {
    reasonCode,
    stage,
    expectedField: field,
    expectedType: "string",
    observedType: "string"
  });
}

function relationshipCategories(value: string) {
  return RELATIONSHIP_PATTERNS
    .filter(([, pattern]) => pattern.test(value))
    .map(([category]) => category);
}

function normalizedRelationshipText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9%$€£]+/g, " ").trim();
}

function hasCanonicalRelationshipSupport(
  claim: string,
  signal: IntelligenceBriefingSignal,
  category: Exclude<RelationshipCategory, "context_attribution">
) {
  if (signal.authority === "reported_context") return false;
  const normalizedClaim = normalizedRelationshipText(claim);
  return signal.fact
    .split(/(?<=[.!?])\s+/)
    .some((sentence) =>
      relationshipCategories(sentence).includes(category)
      && normalizedClaim.includes(normalizedRelationshipText(sentence))
    );
}

function relationshipFailure({
  message,
  field,
  category,
  citedSignalIds
}: {
  message: string;
  field: string;
  category: RelationshipCategory;
  citedSignalIds: readonly string[];
}) {
  return validationFailure(message, {
    reasonCode: "unsupported_relationship",
    stage: "relationship_support",
    expectedField: field,
    expectedType: "string",
    observedType: "string",
    relationshipCategory: category,
    citedSignalIds: [...citedSignalIds]
  });
}

export function validateIntelligenceBriefingOutput(
  value: unknown,
  context: IntelligenceBriefingPackage
): StructuredOutputValidation<IntelligenceBriefingModelOutput> {
  if (context.eligibility === "no_eligible_evidence") {
    return failure("A briefing cannot be generated without eligible evidence.", "evidence_sufficiency_invalid", "ranked_signal_coverage");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return validationFailure("The intelligence briefing response must be one JSON object.", {
      reasonCode: "root_not_object",
      stage: "canonical_schema",
      expectedField: "$",
      expectedType: "object",
      observedType: validationValueType(value)
    });
  }
  const parsed = INTELLIGENCE_BRIEFING_MODEL_OUTPUT_SCHEMA.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.length ? issue.path.join(".") : "$";
    return validationFailure("The intelligence briefing response did not match its strict output contract.", {
      reasonCode: "schema_field_type_mismatch",
      stage: "canonical_schema",
      expectedField: field,
      expectedType: "object",
      observedType: "object",
      fieldPresent: true
    });
  }
  const output = parsed.data;
  const signalByRef = new Map(context.signals.map((signal) => [signal.ref, signal]));
  const allowedSectionById = new Map(context.sections.map((section) => [section.id, new Set(section.signalRefs)]));
  const sectionIds = output.sections.map((section) => section.section_id);
  if (new Set(sectionIds).size !== sectionIds.length) {
    return failure("The briefing repeated a business section.", "schema_field_type_mismatch", "canonical_schema", "sections");
  }
  if (sectionIds.length !== context.sections.length || context.sections.some((section) => !sectionIds.includes(section.id))) {
    return failure("The briefing omitted a supported section or introduced an unsupported one.", "schema_field_type_mismatch", "canonical_schema", "sections");
  }
  const claims = allClaims(output);
  for (const { sectionId, claim } of claims) {
    const refs = [...new Set(claim.support_refs)];
    if (refs.length !== claim.support_refs.length || refs.some((ref) => !signalByRef.has(ref))) {
      return failure("A briefing claim contains an unknown or duplicate support reference.", "invalid_citation_id", "citation_provenance", sectionId);
    }
    if (sectionId !== "executive_summary" && sectionId !== "leadership_considerations") {
      const allowedRefs = allowedSectionById.get(sectionId as (typeof INTELLIGENCE_BRIEFING_SECTION_IDS)[number]);
      if (!allowedRefs || refs.some((ref) => !allowedRefs.has(ref))) {
        return failure("A briefing claim used evidence assigned to another deterministic section.", "invalid_relationship", "relationship_support", sectionId);
      }
    }
    const supportedSignals = refs.map((ref) => signalByRef.get(ref)).filter((signal): signal is IntelligenceBriefingSignal => Boolean(signal));
    if (supportedSignals.some((signal) => signal.authority !== "reported_context" && signal.citationIds.length === 0)) {
      return failure("A material briefing claim does not resolve to eligible citations.", "invalid_citation_id", "citation_provenance", sectionId);
    }
    const usesContext = supportedSignals.some((signal) => signal.authority === "reported_context");
    const detectedRelationships = relationshipCategories(claim.text);
    if (usesContext && detectedRelationships.length) {
      return relationshipFailure({
        message: "Reported context cannot be connected to measured performance without canonical deterministic relationship support.",
        field: sectionId,
        category: detectedRelationships[0],
        citedSignalIds: refs
      });
    }
    const unsupportedRelationship = detectedRelationships.find((category) =>
      !supportedSignals.some((signal) => hasCanonicalRelationshipSupport(claim.text, signal, category))
    );
    if (unsupportedRelationship) {
      return relationshipFailure({
        message: "A briefing claim introduced a relationship not stated by its cited deterministic signals.",
        field: sectionId,
        category: unsupportedRelationship,
        citedSignalIds: refs
      });
    }
    if (usesContext && (!CONTEXT_ATTRIBUTION_PATTERN.test(claim.text) || !CONTEXT_BOUNDARY_PATTERN.test(claim.text))) {
      return relationshipFailure({
        message: "Business Note context must remain attributed and explicitly non-causal.",
        field: sectionId,
        category: "context_attribution",
        citedSignalIds: refs
      });
    }
    if (supportedSignals.some((signal) => contradicts(claim.text, signal))) {
      return failure("A briefing claim contradicted deterministic KPI or finding direction.", "contextual_inconsistency", "numeric_integrity", sectionId);
    }
    const approvedClaimNumbers = new Set([
      ...intelligenceBriefingPeriodNumericTokens(context.period),
      ...supportedSignals.flatMap((signal) => intelligenceBriefingNumericTokens(signal.fact))
    ].map((token) => token.key));
    const emittedClaimNumbers = intelligenceBriefingNumericTokens(claim.text);
    const unsupportedClaimNumbers = emittedClaimNumbers
      .filter((token) => !approvedClaimNumbers.has(token.key));
    if (unsupportedClaimNumbers.length) {
      return validationFailure("A briefing claim used a number that is not present in its cited deterministic signals.", {
        reasonCode: "numeric_integrity_failed",
        stage: "numeric_integrity",
        expectedField: sectionId,
        expectedType: "string",
        observedType: "string",
        expectedCount: 0,
        observedCount: unsupportedClaimNumbers.length,
        citedSignalIds: [...refs],
        numericSupportMode: "claim_local_observed_to_supported_containment",
        supportedNumericCount: approvedClaimNumbers.size,
        emittedNumericCount: emittedClaimNumbers.length,
        unsupportedNumericCount: unsupportedClaimNumbers.length
      });
    }
  }
  const usedRefs = new Set(claims.flatMap(({ claim }) => claim.support_refs));
  if (context.requiredSignalRefs.some((ref) => !usedRefs.has(ref))) {
    return failure("The briefing omitted a required deterministic signal.", "missing_required_signal", "ranked_signal_coverage");
  }
  const limitationRefs = new Set(context.limitations.map((limitation) => limitation.ref));
  if (
    output.limitation_refs.length !== limitationRefs.size
    || new Set(output.limitation_refs).size !== output.limitation_refs.length
    || output.limitation_refs.some((ref) => !limitationRefs.has(ref))
  ) {
    return failure("The briefing did not preserve every application-owned limitation.", "uncertainty_invalid", "contextual_validation", "limitation_refs");
  }
  const text = claims.map(({ claim }) => claim.text).join(" ");
  if (UUID_PATTERN.test(text) || INTERNAL_IDENTIFIER_PATTERN.test(text)) {
    return failure("The briefing exposed an internal identifier.", "contextual_validation_failed", "contextual_validation");
  }
  if (REASONING_PATTERN.test(text)) {
    return failure("The briefing exposed internal reasoning or instructions.", "reasoning_leakage", "contextual_validation");
  }
  if (PREDICTION_CERTAINTY_PATTERN.test(text)) {
    return failure("The briefing expressed unsupported predictive certainty.", "unsupported_inference", "contextual_validation");
  }
  if (TASK_PATTERN.test(text) || HIGH_RISK_ACTION_PATTERN.test(text)) {
    return failure("The briefing introduced task management or an unsupported prescription.", "invalid_action", "contextual_validation");
  }
  if (context.businessHealth.available) {
    const statusTerms = ["Strong", "Watch", "At Risk"];
    const wrongStatus = statusTerms.find((status) => {
      if (status === context.businessHealth.status) return false;
      const escaped = status.replace(/\s+/g, "\\s+");
      return new RegExp(`\\b(?:business health|health status|overall condition)(?:\\s+is|\\s*:)?\\s+${escaped}\\b`, "i").test(text);
    });
    if (wrongStatus) {
      return failure("The briefing contradicted the authoritative Business Health state.", "contextual_inconsistency", "contextual_validation");
    }
  }
  const security = validateAiGeneratedOutput(output as unknown as Json);
  if (!security.ok) {
    return failure("The briefing failed shared generated-output safety validation.", "contextual_validation_failed", "contextual_validation");
  }
  return { ok: true, value: output };
}
