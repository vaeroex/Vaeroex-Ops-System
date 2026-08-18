import "server-only";

import {
  INTELLIGENCE_BRIEFING_CLAIM_ACCEPTANCE_VERSION,
  INTELLIGENCE_BRIEFING_FILTERED_CONTENT_LIMITATION_REF,
  INTELLIGENCE_BRIEFING_GENERATION_POLICY_VERSION,
  INTELLIGENCE_BRIEFING_MINIMUM_MEASURED_CLAIMS,
  INTELLIGENCE_BRIEFING_PROMPT_VERSION,
  INTELLIGENCE_BRIEFING_SCHEMA_VERSION,
  INTELLIGENCE_BRIEFING_VALIDATOR_VERSION,
  type IntelligenceBriefingAcceptedCandidate,
  type IntelligenceBriefingClaim,
  type IntelligenceBriefingClaimRejectionCategory,
  type IntelligenceBriefingModelOutput,
  type IntelligenceBriefingPackage,
  type IntelligenceBriefingSectionId,
  type IntelligenceBriefingSignal
} from "@/lib/ai/intelligence-briefing/contracts";
import {
  INTELLIGENCE_BRIEFING_CLAIM_SCHEMA,
  INTELLIGENCE_BRIEFING_MODEL_OUTPUT_SCHEMA
} from "@/lib/ai/intelligence-briefing/model-output-contract";
import {
  intelligenceBriefingNumericTokens,
  intelligenceBriefingPeriodNumericTokens
} from "@/lib/ai/intelligence-briefing/numeric-integrity";
import { intelligenceBriefingPlainLanguageIssue } from "@/lib/ai/intelligence-briefing/plain-language";
import { composeIntelligenceBriefingExecutiveSummary } from "@/lib/ai/intelligence-briefing/presentation";
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
type ClaimSection = IntelligenceBriefingSectionId | "executive_summary" | "leadership_considerations";
type AcceptedClaim = Readonly<{
  claim: IntelligenceBriefingClaim;
  sectionId: ClaimSection;
  measured: boolean;
}>;

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

function contradicts(claim: string, signal: IntelligenceBriefingSignal) {
  const source = signal.fact.toLowerCase();
  const text = claim.toLowerCase();
  return DIRECTION_PAIRS.some(([left, right]) =>
    (source.includes(left) && text.includes(right)) || (source.includes(right) && text.includes(left))
  );
}

function claimSecurityFailure(text: string, context: IntelligenceBriefingPackage, field: string) {
  if (UUID_PATTERN.test(text) || INTERNAL_IDENTIFIER_PATTERN.test(text)) {
    return failure("The briefing exposed an internal identifier.", "contextual_validation_failed", "contextual_validation", field);
  }
  if (REASONING_PATTERN.test(text)) {
    return failure("The briefing exposed internal reasoning or instructions.", "reasoning_leakage", "contextual_validation", field);
  }
  if (PREDICTION_CERTAINTY_PATTERN.test(text)) {
    return failure("The briefing expressed unsupported predictive certainty.", "unsupported_inference", "contextual_validation", field);
  }
  if (TASK_PATTERN.test(text) || HIGH_RISK_ACTION_PATTERN.test(text)) {
    return failure("The briefing introduced task management or an unsupported prescription.", "invalid_action", "contextual_validation", field);
  }
  if (context.businessHealth.available) {
    const wrongStatus = ["Strong", "Watch", "At Risk"].find((status) => {
      if (status === context.businessHealth.status) return false;
      const escaped = status.replace(/\s+/g, "\\s+");
      return new RegExp(`\\b(?:business health|health status|overall condition)(?:\\s+is|\\s*:)?\\s+${escaped}\\b`, "i").test(text);
    });
    if (wrongStatus) {
      return failure("The briefing contradicted the authoritative Business Health state.", "contextual_inconsistency", "contextual_validation", field);
    }
  }
  const security = validateAiGeneratedOutput({ text } as unknown as Json);
  if (!security.ok) {
    return failure("The briefing failed shared generated-output safety validation.", "contextual_validation_failed", "contextual_validation", field);
  }
  return null;
}

function validateClaim({
  value,
  sectionId,
  context,
  signalByRef,
  allowedSectionRefs
}: {
  value: unknown;
  sectionId: ClaimSection;
  context: IntelligenceBriefingPackage;
  signalByRef: ReadonlyMap<string, IntelligenceBriefingSignal>;
  allowedSectionRefs: ReadonlyMap<IntelligenceBriefingSectionId, ReadonlySet<string>>;
}): StructuredOutputValidation<AcceptedClaim> {
  const parsed = INTELLIGENCE_BRIEFING_CLAIM_SCHEMA.safeParse(value);
  if (!parsed.success) {
    return failure("A briefing claim did not match the bounded claim contract.", "schema_field_type_mismatch", "canonical_schema", sectionId);
  }
  const claim = parsed.data;
  const refs = [...new Set(claim.support_refs)];
  if (refs.length !== claim.support_refs.length || refs.some((ref) => !signalByRef.has(ref))) {
    return failure("A briefing claim contains an unknown or duplicate support reference.", "invalid_citation_id", "citation_provenance", sectionId);
  }
  if (refs.length !== 1) {
    return failure("A briefing claim must remain atomic and bind to exactly one canonical support signal.", "invalid_relationship", "relationship_support", sectionId);
  }
  if (sectionId !== "executive_summary" && sectionId !== "leadership_considerations") {
    const allowedRefs = allowedSectionRefs.get(sectionId);
    if (!allowedRefs || !allowedRefs.has(refs[0])) {
      return failure("A briefing claim used evidence assigned to another deterministic section.", "invalid_relationship", "relationship_support", sectionId);
    }
  }
  const signal = signalByRef.get(refs[0]);
  if (!signal) {
    return failure("A briefing claim contains an unknown support reference.", "invalid_citation_id", "citation_provenance", sectionId);
  }
  if (signal.authority !== "reported_context" && signal.citationIds.length === 0) {
    return failure("A material briefing claim does not resolve to eligible citations.", "invalid_citation_id", "citation_provenance", sectionId);
  }

  const relationships = relationshipCategories(claim.text);
  if (signal.authority === "reported_context") {
    if (relationships.length) {
      return validationFailure("Reported context cannot be connected to measured performance without canonical deterministic relationship support.", {
        reasonCode: "unsupported_relationship",
        stage: "relationship_support",
        expectedField: sectionId,
        expectedType: "string",
        observedType: "string",
        relationshipCategory: relationships[0],
        citedSignalIds: refs
      });
    }
    if (!CONTEXT_ATTRIBUTION_PATTERN.test(claim.text) || !CONTEXT_BOUNDARY_PATTERN.test(claim.text)) {
      return validationFailure("Business Note context must remain attributed and explicitly non-causal.", {
        reasonCode: "unsupported_relationship",
        stage: "relationship_support",
        expectedField: sectionId,
        expectedType: "string",
        observedType: "string",
        relationshipCategory: "context_attribution",
        citedSignalIds: refs
      });
    }
  } else {
    const unsupportedRelationship = relationships.find((category) =>
      !hasCanonicalRelationshipSupport(claim.text, signal, category)
    );
    if (unsupportedRelationship) {
      return validationFailure("A briefing claim introduced a relationship not stated by its cited deterministic signal.", {
        reasonCode: "unsupported_relationship",
        stage: "relationship_support",
        expectedField: sectionId,
        expectedType: "string",
        observedType: "string",
        relationshipCategory: unsupportedRelationship,
        citedSignalIds: refs
      });
    }
  }
  if (contradicts(claim.text, signal)) {
    return failure("A briefing claim contradicted deterministic KPI or finding direction.", "contextual_inconsistency", "numeric_integrity", sectionId);
  }

  const approvedNumbers = new Set([
    ...intelligenceBriefingPeriodNumericTokens(context.period),
    ...intelligenceBriefingNumericTokens(signal.fact)
  ].map((token) => token.key));
  const emittedNumbers = intelligenceBriefingNumericTokens(claim.text);
  const unsupportedNumbers = emittedNumbers.filter((token) => !approvedNumbers.has(token.key));
  if (unsupportedNumbers.length) {
    return validationFailure("A briefing claim used a number that is not present in its cited deterministic signal.", {
      reasonCode: "numeric_integrity_failed",
      stage: "numeric_integrity",
      expectedField: sectionId,
      expectedType: "string",
      observedType: "string",
      expectedCount: 0,
      observedCount: unsupportedNumbers.length,
      citedSignalIds: refs,
      numericSupportMode: "claim_local_observed_to_supported_containment",
      supportedNumericCount: approvedNumbers.size,
      emittedNumericCount: emittedNumbers.length,
      unsupportedNumericCount: unsupportedNumbers.length
    });
  }
  if (signal.periodContext === "historical_context" && /\bduring this briefing period\b/i.test(claim.text)) {
    return failure("A historical claim was incorrectly presented as current-period evidence.", "contextual_inconsistency", "contextual_validation", sectionId);
  }
  if (signal.periodContext === "historical_context" && !/\bhistorical context through\b/i.test(claim.text)) {
    return failure("A historical claim did not retain its explicit time context.", "contextual_inconsistency", "contextual_validation", sectionId);
  }
  if (/\b(?:across\s+\w+\s+(?:recorded dates|weekly records|monthly records)|from\s+.+\s+to\s+)\b/i.test(claim.text)
    && !signal.temporalLineage) {
    return failure("A trend claim exceeded the visible citation lineage.", "invalid_relationship", "citation_provenance", sectionId);
  }
  if (signal.temporalLineage && /\bduring this briefing period\b/i.test(claim.text) && !signal.temporalLineage.fullyInsideBriefingPeriod) {
    return failure("A trend interval extended beyond the briefing period.", "contextual_inconsistency", "contextual_validation", sectionId);
  }
  if (sectionId === "leadership_considerations" && !/^(?:Confirm|Review|Collect|Check|Compare|Monitor|Examine|Verify|Assess|Investigate)\b/i.test(claim.text.trim())) {
    return failure("A leadership action was not a concrete, bounded review step.", "invalid_action", "contextual_validation", sectionId);
  }
  const plainLanguageIssue = intelligenceBriefingPlainLanguageIssue(claim.text, signal);
  if (plainLanguageIssue) {
    return failure("A briefing claim did not meet the customer plain-language standard.", "contextual_validation_failed", "contextual_validation", `${sectionId}:${plainLanguageIssue}`);
  }
  const securityFailure = claimSecurityFailure(claim.text, context, sectionId);
  if (securityFailure) return securityFailure;
  return {
    ok: true,
    value: {
      claim,
      sectionId,
      measured: signal.authority === "measured_evidence" || signal.authority === "deterministic_result"
    }
  };
}

function rejectionKey(category: Omit<IntelligenceBriefingClaimRejectionCategory, "count">) {
  return `${category.reasonCode}\n${category.stage}\n${category.sectionId}`;
}

function aggregateRejections(
  rejections: readonly Omit<IntelligenceBriefingClaimRejectionCategory, "count">[]
): IntelligenceBriefingClaimRejectionCategory[] {
  const aggregated = new Map<string, IntelligenceBriefingClaimRejectionCategory>();
  for (const rejection of rejections) {
    const key = rejectionKey(rejection);
    const current = aggregated.get(key);
    aggregated.set(key, { ...rejection, count: (current?.count || 0) + 1 });
  }
  return [...aggregated.values()].sort((left, right) =>
    left.sectionId.localeCompare(right.sectionId)
      || left.stage.localeCompare(right.stage)
      || left.reasonCode.localeCompare(right.reasonCode)
  );
}

export function validateIntelligenceBriefingOutput(
  value: unknown,
  context: IntelligenceBriefingPackage
): StructuredOutputValidation<IntelligenceBriefingAcceptedCandidate> {
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
    return validationFailure("The intelligence briefing response did not match its strict output contract.", {
      reasonCode: "schema_field_type_mismatch",
      stage: "canonical_schema",
      expectedField: issue?.path.length ? issue.path.join(".") : "$",
      expectedType: "object",
      observedType: "object",
      fieldPresent: true
    });
  }
  const candidate = parsed.data;
  const candidateSectionIds = candidate.sections.map((section) => section.section_id);
  if (new Set(candidateSectionIds).size !== candidateSectionIds.length) {
    return failure("The briefing repeated a business section.", "schema_field_type_mismatch", "canonical_schema", "sections");
  }

  const signalByRef = new Map(context.signals.map((signal) => [signal.ref, signal]));
  const allowedSectionRefs = new Map(context.sections.map((section) => [section.id, new Set(section.signalRefs)]));
  const candidateBySection = new Map(candidate.sections.map((section) => [section.section_id, section]));
  const acceptedBySection = new Map<IntelligenceBriefingSectionId, AcceptedClaim[]>();
  const rejections: Omit<IntelligenceBriefingClaimRejectionCategory, "count">[] = [];
  let totalClaimsReturned = 1 + candidate.leadership_considerations.length;

  const recordResult = (result: StructuredOutputValidation<AcceptedClaim>, sectionId: ClaimSection) => {
    if (result.ok) return result.value;
    rejections.push({
      reasonCode: result.diagnostic?.reasonCode || "unknown_validation_failure",
      stage: result.diagnostic?.stage || "contextual_validation",
      sectionId
    });
    return null;
  };

  for (const section of candidate.sections) {
    totalClaimsReturned += 1 + section.claims.length;
    if (!allowedSectionRefs.has(section.section_id)) {
      for (let index = 0; index < 1 + section.claims.length; index += 1) {
        rejections.push({ reasonCode: "invalid_relationship", stage: "relationship_support", sectionId: section.section_id });
      }
    }
  }

  for (const projectedSection of context.sections) {
    const section = candidateBySection.get(projectedSection.id);
    if (!section) continue;
    const accepted: AcceptedClaim[] = [];
    const values: unknown[] = [
      { text: section.summary, support_refs: section.support_refs },
      ...section.claims
    ];
    for (const claim of values) {
      const result = validateClaim({
        value: claim,
        sectionId: projectedSection.id,
        context,
        signalByRef,
        allowedSectionRefs
      });
      const acceptedClaim = recordResult(result, projectedSection.id);
      if (acceptedClaim) accepted.push(acceptedClaim);
    }
    if (accepted.length) acceptedBySection.set(projectedSection.id, accepted);
  }

  const acceptedMeasuredSectionClaims = context.sections.flatMap((section) =>
    (acceptedBySection.get(section.id) || []).filter((claim) => claim.measured)
  );
  const minimumMeasuredClaims = INTELLIGENCE_BRIEFING_MINIMUM_MEASURED_CLAIMS[context.eligibility];
  if (acceptedMeasuredSectionClaims.length < minimumMeasuredClaims) {
    return validationFailure("The provider candidate retained insufficient independently validated measured claims.", {
      reasonCode: "missing_required_signal",
      stage: "ranked_signal_coverage",
      expectedField: "accepted_measured_claims",
      expectedType: "array",
      observedType: "array",
      expectedCount: minimumMeasuredClaims,
      observedCount: acceptedMeasuredSectionClaims.length
    });
  }

  const retainedSignalRefs = new Set(
    [...acceptedBySection.values()].flatMap((claims) => claims.flatMap((claim) => claim.claim.support_refs))
  );
  const executiveResult = validateClaim({
    value: candidate.executive_summary,
    sectionId: "executive_summary",
    context,
    signalByRef,
    allowedSectionRefs
  });
  let acceptedExecutive = recordResult(executiveResult, "executive_summary");
  if (acceptedExecutive && !acceptedExecutive.claim.support_refs.every((ref) => retainedSignalRefs.has(ref))) {
    rejections.push({ reasonCode: "missing_required_signal", stage: "ranked_signal_coverage", sectionId: "executive_summary" });
    acceptedExecutive = null;
  }
  const acceptedLeadership = candidate.leadership_considerations.flatMap((claim) => {
    const result = validateClaim({
      value: claim,
      sectionId: "leadership_considerations",
      context,
      signalByRef,
      allowedSectionRefs
    });
    const accepted = recordResult(result, "leadership_considerations");
    if (!accepted) return [];
    if (!accepted.claim.support_refs.every((ref) => retainedSignalRefs.has(ref))) {
      rejections.push({ reasonCode: "missing_required_signal", stage: "ranked_signal_coverage", sectionId: "leadership_considerations" });
      return [];
    }
    return [accepted.claim];
  });

  const sections = context.sections.flatMap((projectedSection) => {
    const accepted = acceptedBySection.get(projectedSection.id) || [];
    if (!accepted.length) return [];
    return [{
      section_id: projectedSection.id,
      summary: accepted[0].claim.text,
      support_refs: accepted[0].claim.support_refs,
      claims: accepted.slice(1).map((entry) => entry.claim)
    }];
  });
  const retainedSections = sections.map((section) => section.section_id);
  const omittedSections = context.sections
    .map((section) => section.id)
    .filter((sectionId) => !retainedSections.includes(sectionId));
  const rejectionCategories = aggregateRejections(rejections);
  const includeFilteredContentLimitation = context.eligibility === "limited" || rejections.length > 0 || omittedSections.length > 0;
  const acceptedAnalysis: IntelligenceBriefingModelOutput = {
    executive_summary: acceptedExecutive?.claim || acceptedMeasuredSectionClaims[0].claim,
    sections,
    leadership_considerations: acceptedLeadership,
    limitation_refs: [
      ...context.limitations.map((limitation) => limitation.ref),
      ...(includeFilteredContentLimitation ? [INTELLIGENCE_BRIEFING_FILTERED_CONTENT_LIMITATION_REF] : [])
    ]
  };
  const analysis: IntelligenceBriefingModelOutput = {
    ...acceptedAnalysis,
    executive_summary: composeIntelligenceBriefingExecutiveSummary({
      analysis: acceptedAnalysis,
      signals: context.signals,
      eligibility: context.eligibility,
      evidenceCoverage: context.evidenceCoverage,
      limitations: context.limitations,
      contextReferences: context.contextReferences
    })
  };
  const finalSecurity = validateAiGeneratedOutput(analysis as unknown as Json);
  if (!finalSecurity.ok) {
    return failure("The accepted briefing failed shared generated-output safety validation.", "contextual_validation_failed", "contextual_validation");
  }
  const acceptedClaims = [
    ...(acceptedExecutive ? [acceptedExecutive.claim] : []),
    ...[...acceptedBySection.values()].flatMap((claims) => claims.map((claim) => claim.claim)),
    ...acceptedLeadership
  ];
  const acceptedSignalRefs = [...new Set([
    ...analysis.executive_summary.support_refs,
    ...analysis.sections.flatMap((section) => [section.support_refs, ...section.claims.map((claim) => claim.support_refs)].flat()),
    ...analysis.leadership_considerations.flatMap((claim) => claim.support_refs)
  ])];

  return {
    ok: true,
    value: {
      analysis,
      acceptedSignalRefs,
      acceptance: {
        version: INTELLIGENCE_BRIEFING_CLAIM_ACCEPTANCE_VERSION,
        totalClaimsReturned,
        acceptedClaimCount: acceptedClaims.length,
        rejectedClaimCount: rejections.length,
        acceptedMeasuredClaimCount: acceptedMeasuredSectionClaims.length,
        retainedSections,
        omittedSections,
        rejectionCategories,
        promptVersion: INTELLIGENCE_BRIEFING_PROMPT_VERSION,
        schemaVersion: INTELLIGENCE_BRIEFING_SCHEMA_VERSION,
        validatorVersion: INTELLIGENCE_BRIEFING_VALIDATOR_VERSION,
        generationPolicyVersion: INTELLIGENCE_BRIEFING_GENERATION_POLICY_VERSION
      }
    }
  };
}
