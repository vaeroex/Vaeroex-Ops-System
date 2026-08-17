import "server-only";

import { z } from "zod";
import {
  INTELLIGENCE_BRIEFING_SECTION_IDS,
  type IntelligenceBriefingClaim,
  type IntelligenceBriefingModelOutput,
  type IntelligenceBriefingPackage,
  type IntelligenceBriefingSignal
} from "@/lib/ai/intelligence-briefing/contracts";
import type { StructuredOutputValidation } from "@/lib/ai/providers/provider-manager";
import {
  validationFailure,
  validationValueType,
  type AIValidationReasonCode,
  type AIValidationStage
} from "@/lib/ai/validation-diagnostics";
import { validateAiGeneratedOutput } from "@/lib/security/ai-output-validation";
import type { Json } from "@/lib/supabase/types";

const claimSchema = z.object({
  text: z.string().trim().min(20).max(700),
  support_refs: z.array(z.string().trim().min(1).max(24)).min(1).max(12)
}).strict();
const outputSchema = z.object({
  executive_summary: z.object({
    text: z.string().trim().min(60).max(1_200),
    support_refs: z.array(z.string().trim().min(1).max(24)).min(1).max(12)
  }).strict(),
  sections: z.array(z.object({
    section_id: z.enum(INTELLIGENCE_BRIEFING_SECTION_IDS),
    summary: z.string().trim().min(30).max(800),
    support_refs: z.array(z.string().trim().min(1).max(24)).min(1).max(12),
    claims: z.array(claimSchema).min(1).max(5)
  }).strict()).max(INTELLIGENCE_BRIEFING_SECTION_IDS.length),
  leadership_considerations: z.array(claimSchema).min(1).max(5),
  limitation_refs: z.array(z.string().trim().min(1).max(24)).max(12)
}).strict();

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const INTERNAL_IDENTIFIER_PATTERN = /\b(?:workspace_id|source_file_id|candidate_id|manifest_id|raw_data_json|input_json|output_json)\b/i;
const REASONING_PATTERN = /\b(?:chain of thought|hidden reasoning|internal reasoning|system prompt|step-by-step reasoning)\b|<\/?think>/i;
const CAUSAL_PATTERN = /\b(?:cause(?:d|s)?|because of|results? in|leads? to|drives?|due to|therefore|consequently|proves?)\b/i;
const PREDICTION_CERTAINTY_PATTERN = /\b(?:will definitely|guaranteed|certain to|without doubt|inevitably)\b/i;
const TASK_PATTERN = /\b(?:assign(?:ed)? to|owner\s*:|due date|deadline|create a task|project plan|work item|to-do)\b/i;
const HIGH_RISK_ACTION_PATTERN = /\b(?:hire|fire|lay off|acquire|sell the company|borrow|increase budget|reduce headcount)\b/i;
const CONTEXT_ATTRIBUTION_PATTERN = /\b(?:approved business note|business note reports?|leadership reported|reported context|the note reports?)\b/i;
const CONTEXT_BOUNDARY_PATTERN = /\b(?:does not establish causation|may provide context|could be relevant|reported context|not independently measured)\b/i;
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

function numericClaims(value: string) {
  return value.match(/(?<![A-Za-z0-9])-?\$?\d[\d,]*(?:\.\d+)?%?/g) || [];
}

function normalizeNumber(value: string) {
  return value.replace(/[$,%\s]/g, "").replace(/^\+/, "");
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
  const parsed = outputSchema.safeParse(value);
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
    if (usesContext && (!CONTEXT_ATTRIBUTION_PATTERN.test(claim.text) || !CONTEXT_BOUNDARY_PATTERN.test(claim.text))) {
      return failure("Business Note context must remain attributed and explicitly non-causal.", "unsupported_relationship", "relationship_support", sectionId);
    }
    if (supportedSignals.some((signal) => contradicts(claim.text, signal))) {
      return failure("A briefing claim contradicted deterministic KPI or finding direction.", "contextual_inconsistency", "numeric_integrity", sectionId);
    }
    const approvedClaimNumbers = new Set(numericClaims(JSON.stringify({
      period: context.period,
      signals: supportedSignals.map((signal) => signal.fact)
    })).map(normalizeNumber));
    if (numericClaims(claim.text).some((number) => !approvedClaimNumbers.has(normalizeNumber(number)))) {
      return failure("A briefing claim used a number that is not present in its cited deterministic signals.", "numeric_integrity_failed", "numeric_integrity", sectionId);
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
  if (CAUSAL_PATTERN.test(text)) {
    return failure("The briefing introduced an unsupported causal relationship.", "unsupported_relationship", "relationship_support");
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
