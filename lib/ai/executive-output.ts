import "server-only";

import { z } from "zod";
import type {
  ExecutiveConfidence,
  ExecutiveEvidenceReference,
  ExecutiveEvidenceSufficiency,
  ExecutiveIntelligenceBriefing,
  GlobalSearchAnswer
} from "@/lib/search/types";
import type { Json } from "@/lib/supabase/types";
import {
  validationFailure,
  validationValueType,
  type AIValidationReasonCode,
  type AIValidationStage,
  type StructuredOutputValidation
} from "@/lib/ai/validation-diagnostics";

export const EXECUTIVE_CANONICAL_MAX_OUTPUT_TOKENS = 520;

const confidenceSchema = z.enum(["High", "Medium", "Low", "Insufficient"]);
const evidenceSufficiencySchema = z.enum(["Sufficient", "Partial", "Conflicting", "Insufficient"]);
const evidenceAgreementSchema = z.enum(["Aligned", "Mixed", "Conflicting", "Insufficient"]);
const findingIdSchema = z.string().regex(/^F[1-3]$/);
const signalIdSchema = z.string().regex(/^S[1-9]\d*$/);
const actionIdSchema = z.string().regex(/^A[1-3]$/);
const citationIdsSchema = z.array(z.number().int().positive()).min(1).max(5);
const relationshipStatusSchema = z.enum(["Supported", "Possible", "Not established"]);

const executiveFindingSchema = z.object({
  id: findingIdSchema,
  signal_id: signalIdSchema,
  finding: z.string().trim().min(1).max(240),
  impact: z.string().trim().min(1).max(200),
  confidence: confidenceSchema,
  citations: citationIdsSchema
}).strict();

const executiveRelationshipSchema = z.object({
  finding_ids: z.array(findingIdSchema).length(2),
  status: relationshipStatusSchema,
  assessment: z.string().trim().min(1).max(240),
  citations: citationIdsSchema
}).strict();

const executiveActionSchema = z.object({
  id: actionIdSchema,
  action: z.string().trim().min(1).max(220),
  priority: z.enum(["Critical", "High", "Medium", "Low"]),
  why: z.string().trim().min(1).max(200),
  outcome: z.string().trim().min(1).max(180),
  horizon: z.enum(["Immediate", "30 Days", "90 Days", "Long-Term"]),
  citations: citationIdsSchema
}).strict();

const executiveAnalysisSchema = z.object({
  evidence_sufficiency: evidenceSufficiencySchema,
  evidence_agreement: evidenceAgreementSchema,
  findings: z.array(executiveFindingSchema).min(1).max(3),
  relationships: z.array(executiveRelationshipSchema).max(2),
  actions: z.array(executiveActionSchema).min(1).max(3),
  uncertainty: z.array(z.string().trim().min(1).max(180)).max(3)
}).strict();

const executiveIntelligenceOutputSchema = z.object({
  analysis: executiveAnalysisSchema,
  executive_summary: z.string().trim().min(1).max(600),
  overall_confidence: confidenceSchema,
  summary_signal_ids: z.array(signalIdSchema).min(1).max(3)
}).strict().superRefine((value, context) => {
  const findingIds = value.analysis.findings.map((item) => item.id);
  const findingIdSet = new Set(findingIds);
  const findingSignals = value.analysis.findings.map((item) => item.signal_id);
  const actionIds = value.analysis.actions.map((item) => item.id);

  if (findingIdSet.size !== findingIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["analysis", "findings"], message: "Finding IDs must be unique." });
  }
  if (new Set(findingSignals).size !== findingSignals.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["analysis", "findings"], message: "Each executive finding must represent a distinct signal." });
  }
  if (new Set(actionIds).size !== actionIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["analysis", "actions"], message: "Action IDs must be unique." });
  }
  if (new Set(value.summary_signal_ids).size !== value.summary_signal_ids.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["summary_signal_ids"], message: "Summary signal IDs must be unique." });
  }
  if (value.summary_signal_ids.some((signalId) => !findingSignals.includes(signalId))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["summary_signal_ids"], message: "The summary may reference only signals represented by returned findings." });
  }

  value.analysis.relationships.forEach((relationship, index) => {
    const [left, right] = relationship.finding_ids;
    if (left === right || !findingIdSet.has(left) || !findingIdSet.has(right)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["analysis", "relationships", index, "finding_ids"],
        message: "A relationship must connect two distinct findings returned in this analysis."
      });
    }
  });

  if (value.analysis.evidence_sufficiency !== "Sufficient" && value.overall_confidence === "High") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["overall_confidence"],
      message: "High confidence is not allowed when evidence is partial, conflicting, or insufficient."
    });
  }
  if (value.analysis.evidence_sufficiency === "Insufficient" && !["Low", "Insufficient"].includes(value.overall_confidence)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["overall_confidence"],
      message: "Insufficient evidence permits only Low or Insufficient confidence."
    });
  }
  if (value.analysis.evidence_sufficiency === "Conflicting" && value.analysis.evidence_agreement !== "Conflicting") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["analysis", "evidence_agreement"],
      message: "Conflicting evidence must retain a Conflicting agreement assessment."
    });
  }
  if ((value.overall_confidence !== "High" || value.analysis.evidence_sufficiency !== "Sufficient") && value.analysis.uncertainty.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["analysis", "uncertainty"],
      message: "Limited confidence or evidence requires at least one explicit uncertainty or missing input."
    });
  }
});

export type ExecutiveCitationCatalogEntry = {
  citationId: number;
  title: string;
  sourceType: string;
  support?: string;
  independentSourceKey: string | null;
  evidenceRole: "original" | "supporting" | "derived" | "historical";
  freshnessScore: number;
  directRelevanceScore: number;
  domain?: string;
  signalId?: string | null;
  findingEligible?: boolean;
  executiveRank?: number | null;
};

export type ExecutiveSignalValidationPolicy = {
  minimumDistinctFindings: number;
  requiredSignalIds: string[];
  requireCrossSignalAssessment: boolean;
  relationships?: Array<{ leftSignalId: string; rightSignalId: string }>;
};

type ParsedExecutiveOutput = z.infer<typeof executiveIntelligenceOutputSchema>;
type ParsedFinding = ParsedExecutiveOutput["analysis"]["findings"][number];
type ParsedAction = ParsedExecutiveOutput["analysis"]["actions"][number];

const CONFIDENCE_RANK: Record<ExecutiveConfidence, number> = {
  Insufficient: 0,
  Low: 1,
  Medium: 2,
  High: 3
};

function hasKeyOrder(value: Record<string, unknown>, expected: string[]) {
  const keys = Object.keys(value);
  let previous = -1;
  for (const key of expected) {
    const index = keys.indexOf(key);
    if (index < 0 || index <= previous) return false;
    previous = index;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function contractFailure({
  reason,
  reasonCode,
  stage = "canonical_schema",
  expectedField,
  expectedType,
  observed,
  expectedCount,
  observedCount,
  fieldPresent
}: {
  reason: string;
  reasonCode: AIValidationReasonCode;
  stage?: AIValidationStage;
  expectedField?: string;
  expectedType?: "undefined" | "null" | "boolean" | "number" | "string" | "array" | "object";
  observed?: unknown;
  expectedCount?: number;
  observedCount?: number;
  fieldPresent?: boolean;
}) {
  return validationFailure(reason, {
    reasonCode,
    stage,
    expectedField,
    expectedType,
    observedType: observed === undefined && fieldPresent === false ? "undefined" : validationValueType(observed),
    expectedCount,
    observedCount,
    fieldPresent,
    truncationDetected: false
  });
}

function canonicalShapeFailure(value: Record<string, unknown>): StructuredOutputValidation<never> | null {
  if (!hasOwn(value, "analysis")) {
    return contractFailure({ reason: "Executive analysis is required.", reasonCode: "missing_analysis", expectedField: "analysis", expectedType: "object", observed: undefined, fieldPresent: false });
  }
  if (!isRecord(value.analysis)) {
    return contractFailure({ reason: "Executive analysis must be an object.", reasonCode: "invalid_analysis_shape", expectedField: "analysis", expectedType: "object", observed: value.analysis, fieldPresent: true });
  }
  const analysis = value.analysis;

  if (!evidenceSufficiencySchema.safeParse(analysis.evidence_sufficiency).success) {
    return contractFailure({ reason: "Evidence sufficiency is invalid.", reasonCode: "evidence_sufficiency_invalid", expectedField: "analysis.evidence_sufficiency", expectedType: "string", observed: analysis.evidence_sufficiency, fieldPresent: hasOwn(analysis, "evidence_sufficiency") });
  }
  if (!evidenceAgreementSchema.safeParse(analysis.evidence_agreement).success) {
    return contractFailure({ reason: "Evidence agreement is invalid.", reasonCode: "agreement_invalid", expectedField: "analysis.evidence_agreement", expectedType: "string", observed: analysis.evidence_agreement, fieldPresent: hasOwn(analysis, "evidence_agreement") });
  }
  if (!hasOwn(analysis, "findings")) {
    return contractFailure({ reason: "Executive findings are required.", reasonCode: "missing_findings", expectedField: "analysis.findings", expectedType: "array", observed: undefined, fieldPresent: false });
  }
  if (!Array.isArray(analysis.findings)) {
    return contractFailure({ reason: "Executive findings must be an array.", reasonCode: "findings_not_array", expectedField: "analysis.findings", expectedType: "array", observed: analysis.findings, fieldPresent: true });
  }
  if (analysis.findings.length < 1) {
    return contractFailure({ reason: "At least one executive finding is required.", reasonCode: "insufficient_required_findings", expectedField: "analysis.findings", expectedType: "array", observed: analysis.findings, expectedCount: 1, observedCount: analysis.findings.length, fieldPresent: true });
  }

  const findingSignals: string[] = [];
  const findingIds: string[] = [];
  for (const finding of analysis.findings) {
    if (!isRecord(finding)) {
      return contractFailure({ reason: "Each finding must be an object.", reasonCode: "schema_field_type_mismatch", expectedField: "analysis.findings[]", expectedType: "object", observed: finding, fieldPresent: true });
    }
    if (typeof finding.signal_id !== "string" || !signalIdSchema.safeParse(finding.signal_id).success) {
      return contractFailure({ reason: "A finding signal ID is invalid.", reasonCode: "unknown_signal_id", expectedField: "analysis.findings[].signal_id", expectedType: "string", observed: finding.signal_id, fieldPresent: hasOwn(finding, "signal_id") });
    }
    findingSignals.push(finding.signal_id);
    if (typeof finding.id === "string") findingIds.push(finding.id);
    if (!Array.isArray(finding.citations) || finding.citations.some((citation) => !Number.isInteger(citation) || Number(citation) <= 0)) {
      return contractFailure({ reason: "Finding citation IDs are invalid.", reasonCode: "invalid_citation_id", expectedField: "analysis.findings[].citations", expectedType: "array", observed: finding.citations, fieldPresent: hasOwn(finding, "citations") });
    }
  }
  if (new Set(findingSignals).size !== findingSignals.length) {
    return contractFailure({ reason: "Each finding must represent a distinct signal.", reasonCode: "duplicate_signal_id", expectedField: "analysis.findings[].signal_id", expectedType: "string", observed: analysis.findings, expectedCount: findingSignals.length, observedCount: new Set(findingSignals).size, fieldPresent: true });
  }
  if (new Set(findingIds).size !== analysis.findings.length) {
    return contractFailure({ reason: "Finding IDs must be unique and valid.", reasonCode: "contextual_validation_failed", expectedField: "analysis.findings[].id", expectedType: "string", observed: analysis.findings, expectedCount: analysis.findings.length, observedCount: new Set(findingIds).size, fieldPresent: true });
  }

  if (!Array.isArray(analysis.relationships)) {
    return contractFailure({ reason: "Relationships must be an array.", reasonCode: "invalid_relationship", expectedField: "analysis.relationships", expectedType: "array", observed: analysis.relationships, fieldPresent: hasOwn(analysis, "relationships") });
  }
  for (const relationship of analysis.relationships) {
    if (!isRecord(relationship) || !Array.isArray(relationship.finding_ids) || relationship.finding_ids.length !== 2 || !Array.isArray(relationship.citations)) {
      return contractFailure({ reason: "A relationship is invalid.", reasonCode: "invalid_relationship", expectedField: "analysis.relationships[]", expectedType: "object", observed: relationship, fieldPresent: true });
    }
    if (relationship.citations.some((citation) => !Number.isInteger(citation) || Number(citation) <= 0)) {
      return contractFailure({ reason: "Relationship citation IDs are invalid.", reasonCode: "invalid_citation_id", expectedField: "analysis.relationships[].citations", expectedType: "array", observed: relationship.citations, fieldPresent: true });
    }
  }

  if (!Array.isArray(analysis.actions) || analysis.actions.length < 1) {
    return contractFailure({ reason: "At least one valid action is required.", reasonCode: "invalid_action", expectedField: "analysis.actions", expectedType: "array", observed: analysis.actions, expectedCount: 1, observedCount: Array.isArray(analysis.actions) ? analysis.actions.length : undefined, fieldPresent: hasOwn(analysis, "actions") });
  }
  for (const action of analysis.actions) {
    if (!isRecord(action) || !Array.isArray(action.citations) || action.citations.some((citation) => !Number.isInteger(citation) || Number(citation) <= 0)) {
      return contractFailure({ reason: "An executive action is invalid.", reasonCode: "invalid_action", expectedField: "analysis.actions[]", expectedType: "object", observed: action, fieldPresent: true });
    }
  }

  if (!Array.isArray(analysis.uncertainty) || analysis.uncertainty.some((item) => typeof item !== "string")) {
    return contractFailure({ reason: "Uncertainty must be an array of strings.", reasonCode: "uncertainty_invalid", expectedField: "analysis.uncertainty", expectedType: "array", observed: analysis.uncertainty, fieldPresent: hasOwn(analysis, "uncertainty") });
  }

  if (!hasOwn(value, "executive_summary") || typeof value.executive_summary !== "string" || !value.executive_summary.trim()) {
    return contractFailure({ reason: "Executive summary is required.", reasonCode: "executive_summary_missing", expectedField: "executive_summary", expectedType: "string", observed: value.executive_summary, fieldPresent: hasOwn(value, "executive_summary") });
  }
  if (!confidenceSchema.safeParse(value.overall_confidence).success) {
    return contractFailure({ reason: "Overall confidence is invalid.", reasonCode: "invalid_overall_confidence", stage: "confidence", expectedField: "overall_confidence", expectedType: "string", observed: value.overall_confidence, fieldPresent: hasOwn(value, "overall_confidence") });
  }
  if (!hasOwn(value, "summary_signal_ids")) {
    return contractFailure({ reason: "Summary signal IDs are required.", reasonCode: "missing_summary_signal_ids", expectedField: "summary_signal_ids", expectedType: "array", observed: undefined, fieldPresent: false });
  }
  if (!Array.isArray(value.summary_signal_ids) || value.summary_signal_ids.some((signalId) => typeof signalId !== "string" || !signalIdSchema.safeParse(signalId).success)) {
    return contractFailure({ reason: "Summary signal IDs are invalid.", reasonCode: "invalid_summary_signal_ids", expectedField: "summary_signal_ids", expectedType: "array", observed: value.summary_signal_ids, fieldPresent: true });
  }
  if (new Set(value.summary_signal_ids).size !== value.summary_signal_ids.length || value.summary_signal_ids.some((signalId) => !findingSignals.includes(signalId))) {
    return contractFailure({ reason: "Summary signal IDs must be unique returned signals.", reasonCode: "invalid_summary_signal_ids", expectedField: "summary_signal_ids", expectedType: "array", observed: value.summary_signal_ids, expectedCount: value.summary_signal_ids.length, observedCount: new Set(value.summary_signal_ids).size, fieldPresent: true });
  }

  if (!hasKeyOrder(value, ["analysis", "executive_summary", "overall_confidence", "summary_signal_ids"])) {
    return contractFailure({ reason: "Executive analysis must be completed before the summary is written.", reasonCode: "contextual_validation_failed", expectedField: "canonical_field_order", expectedType: "object", observed: value, fieldPresent: true });
  }
  if (!hasKeyOrder(analysis, ["evidence_sufficiency", "evidence_agreement", "findings", "relationships", "actions", "uncertainty"])) {
    return contractFailure({ reason: "Executive reasoning stages were not returned in the required order.", reasonCode: "invalid_analysis_shape", expectedField: "analysis_field_order", expectedType: "object", observed: analysis, fieldPresent: true });
  }

  return null;
}

export function validateExecutiveIntelligenceContract(value: unknown): StructuredOutputValidation<Json> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return contractFailure({ reason: "The executive response must be an object.", reasonCode: "root_not_object", expectedField: "$", expectedType: "object", observed: value, fieldPresent: value !== undefined });
  }

  const objectValue = value as Record<string, unknown>;
  const shapeFailure = canonicalShapeFailure(objectValue);
  if (shapeFailure) return shapeFailure;

  const parsed = executiveIntelligenceOutputSchema.safeParse(value);
  return parsed.success
    ? { ok: true as const, value: parsed.data as Json }
    : contractFailure({
        reason: parsed.error.issues[0]?.message || "The executive response did not match its contract.",
        reasonCode: "schema_field_type_mismatch",
        expectedField: parsed.error.issues[0]?.path.join(".") || "$",
        observed: value,
        fieldPresent: true
      });
}

function parsedExecutiveOutput(value: unknown): ParsedExecutiveOutput | null {
  const parsed = executiveIntelligenceOutputSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function citationObjects(citations: number[]) {
  return citations.map((citation_id) => ({ citation_id }));
}

function decisionCitationIds(value: ParsedExecutiveOutput) {
  return [
    ...value.analysis.findings.flatMap((item) => item.citations),
    ...value.analysis.relationships.flatMap((item) => item.citations),
    ...value.analysis.actions.flatMap((item) => item.citations)
  ];
}

function independentSourceKeysForCitations(
  citations: number[],
  catalogById: Map<number, ExecutiveCitationCatalogEntry>,
  currentOnly = false
) {
  return new Set(
    citations
      .map((citationId) => catalogById.get(citationId))
      .filter(
        (item): item is ExecutiveCitationCatalogEntry =>
          item !== undefined && item.evidenceRole === "original" && (!currentOnly || item.freshnessScore >= 60)
      )
      .map((item) => item.independentSourceKey)
      .filter((key): key is string => Boolean(key))
  );
}

function originalSourceTypesForCitations(
  citations: number[],
  catalogById: Map<number, ExecutiveCitationCatalogEntry>
) {
  return new Set(
    citations
      .map((citationId) => catalogById.get(citationId))
      .filter((item): item is ExecutiveCitationCatalogEntry => item !== undefined && item.evidenceRole === "original")
      .map((item) => item.sourceType)
  );
}

function signalIdsForCitations(
  citations: number[],
  catalogById: Map<number, ExecutiveCitationCatalogEntry>
) {
  return new Set(
    citations
      .map((citationId) => catalogById.get(citationId))
      .filter((item): item is ExecutiveCitationCatalogEntry => Boolean(item?.signalId) && item?.findingEligible === true)
      .map((item) => item.signalId as string)
  );
}

function earliestExecutiveRank(citations: number[], catalogById: Map<number, ExecutiveCitationCatalogEntry>) {
  const ranks = citations
    .map((citationId) => catalogById.get(citationId)?.executiveRank)
    .filter((rank): rank is number => typeof rank === "number");
  return ranks.length ? Math.min(...ranks) : Number.POSITIVE_INFINITY;
}

function maximumConfidence(independentSourceCount: number, currentIndependentSourceCount: number): ExecutiveConfidence {
  if (currentIndependentSourceCount >= 3) return "High";
  if (currentIndependentSourceCount >= 2) return "Medium";
  if (independentSourceCount >= 1) return "Low";
  return "Insufficient";
}

function cappedConfidence(
  requested: ExecutiveConfidence,
  independentSourceCount: number,
  currentIndependentSourceCount: number,
  sufficiency: ExecutiveEvidenceSufficiency,
  evidenceAgreement: ParsedExecutiveOutput["analysis"]["evidence_agreement"]
): ExecutiveConfidence {
  let maximum = maximumConfidence(independentSourceCount, currentIndependentSourceCount);
  if (sufficiency === "Insufficient") maximum = independentSourceCount ? "Low" : "Insufficient";
  if ((sufficiency === "Partial" || sufficiency === "Conflicting") && maximum === "High") maximum = "Medium";
  if ((evidenceAgreement === "Mixed" || evidenceAgreement === "Conflicting") && maximum === "High") maximum = "Medium";
  return CONFIDENCE_RANK[requested] <= CONFIDENCE_RANK[maximum] ? requested : maximum;
}

const CONFIDENCE_CEILING_UNCERTAINTY = "Confidence is limited by the available independent source coverage.";

export function applyExecutiveConfidenceCeilings(
  value: Json,
  catalog: ExecutiveCitationCatalogEntry[]
): Json {
  const parsed = parsedExecutiveOutput(value);
  if (!parsed) return value;

  const catalogById = new Map(catalog.map((item) => [item.citationId, item]));
  let findingConfidenceChanged = false;
  const findings = parsed.analysis.findings.map((finding) => {
    const sourceCount = independentSourceKeysForCitations(finding.citations, catalogById).size;
    const currentSourceCount = independentSourceKeysForCitations(finding.citations, catalogById, true).size;
    const confidence = cappedConfidence(
      finding.confidence,
      sourceCount,
      currentSourceCount,
      parsed.analysis.evidence_sufficiency,
      parsed.analysis.evidence_agreement
    );
    findingConfidenceChanged ||= confidence !== finding.confidence;
    return confidence === finding.confidence ? finding : { ...finding, confidence };
  });

  const decisionCitations = decisionCitationIds(parsed);
  const overallConfidence = cappedConfidence(
    parsed.overall_confidence,
    independentSourceKeysForCitations(decisionCitations, catalogById).size,
    independentSourceKeysForCitations(decisionCitations, catalogById, true).size,
    parsed.analysis.evidence_sufficiency,
    parsed.analysis.evidence_agreement
  );
  const overallConfidenceChanged = overallConfidence !== parsed.overall_confidence;
  if (!findingConfidenceChanged && !overallConfidenceChanged) return value;

  const uncertainty = overallConfidenceChanged && overallConfidence !== "High" && parsed.analysis.uncertainty.length === 0
    ? [CONFIDENCE_CEILING_UNCERTAINTY]
    : parsed.analysis.uncertainty;

  return {
    analysis: {
      evidence_sufficiency: parsed.analysis.evidence_sufficiency,
      evidence_agreement: parsed.analysis.evidence_agreement,
      findings,
      relationships: parsed.analysis.relationships,
      actions: parsed.analysis.actions,
      uncertainty
    },
    executive_summary: parsed.executive_summary,
    overall_confidence: overallConfidence,
    summary_signal_ids: parsed.summary_signal_ids
  } as Json;
}

function allowedRelationshipPair(
  leftSignalId: string,
  rightSignalId: string,
  relationships: ExecutiveSignalValidationPolicy["relationships"]
) {
  if (!relationships?.length) return true;
  return relationships.some((candidate) =>
    (candidate.leftSignalId === leftSignalId && candidate.rightSignalId === rightSignalId) ||
    (candidate.leftSignalId === rightSignalId && candidate.rightSignalId === leftSignalId)
  );
}

export function validateExecutiveEvidenceReferences(
  value: Json,
  catalog: ExecutiveCitationCatalogEntry[],
  signalPolicy?: ExecutiveSignalValidationPolicy
): StructuredOutputValidation<Json> {
  const parsed = parsedExecutiveOutput(value);
  if (!parsed) {
    return contractFailure({ reason: "The executive response did not match its contract.", reasonCode: "contextual_validation_failed", stage: "contextual_validation", expectedField: "$", expectedType: "object", observed: value, fieldPresent: true });
  }

  const catalogById = new Map(catalog.map((item) => [item.citationId, item]));
  const unknownCitation = decisionCitationIds(parsed).find((citationId) => !catalogById.has(citationId));
  if (unknownCitation) {
    return contractFailure({ reason: `Evidence reference ${unknownCitation} was not supplied to this request.`, reasonCode: "invalid_citation_id", stage: "citation_provenance", expectedField: "analysis.*.citations", expectedType: "array", observed: decisionCitationIds(parsed), fieldPresent: true });
  }

  const findingsById = new Map(parsed.analysis.findings.map((finding) => [finding.id, finding]));
  for (const finding of parsed.analysis.findings) {
    const citationSignals = signalIdsForCitations(finding.citations, catalogById);
    if (!citationSignals.has(finding.signal_id)) {
      return contractFailure({ reason: `Finding ${finding.id} is not supported by eligible citations for ${finding.signal_id}.`, reasonCode: "missing_required_signal", stage: "citation_provenance", expectedField: "analysis.findings[].citations", expectedType: "array", observed: finding.citations, fieldPresent: true });
    }
    const sourceCount = independentSourceKeysForCitations(finding.citations, catalogById).size;
    const currentSourceCount = independentSourceKeysForCitations(finding.citations, catalogById, true).size;
    if (sourceCount < 1) {
      return contractFailure({ reason: "Every business finding must trace to eligible original evidence.", reasonCode: "contextual_validation_failed", stage: "citation_provenance", expectedField: "analysis.findings[].citations", expectedType: "array", observed: finding.citations, expectedCount: 1, observedCount: sourceCount, fieldPresent: true });
    }
    const allowedConfidence = cappedConfidence(
      finding.confidence,
      sourceCount,
      currentSourceCount,
      parsed.analysis.evidence_sufficiency,
      parsed.analysis.evidence_agreement
    );
    if (allowedConfidence !== finding.confidence) {
      return contractFailure({ reason: `Finding ${finding.id} exceeds the confidence supported by its cited evidence.`, reasonCode: "confidence_ceiling_exceeded", stage: "confidence", expectedField: "analysis.findings[].confidence", expectedType: "string", observed: finding.confidence, fieldPresent: true });
    }
  }

  if (signalPolicy && signalPolicy.minimumDistinctFindings > 0) {
    const minimum = Math.min(3, signalPolicy.minimumDistinctFindings);
    const requiredSignalIds = signalPolicy.requiredSignalIds.slice(0, minimum);
    const returnedSignalIds = parsed.analysis.findings.slice(0, minimum).map((finding) => finding.signal_id);
    if (parsed.analysis.findings.length < minimum) {
      return contractFailure({ reason: `The executive analysis must retain ${minimum} findings.`, reasonCode: "insufficient_required_findings", stage: "ranked_signal_coverage", expectedField: "analysis.findings", expectedType: "array", observed: parsed.analysis.findings, expectedCount: minimum, observedCount: parsed.analysis.findings.length, fieldPresent: true });
    }
    if (requiredSignalIds.some((signalId, index) => returnedSignalIds[index] !== signalId)) {
      return contractFailure({ reason: `The executive analysis must retain the ${minimum} highest-priority distinct evidence-backed findings in order.`, reasonCode: "missing_required_signal", stage: "ranked_signal_coverage", expectedField: "analysis.findings[].signal_id", expectedType: "string", observed: returnedSignalIds, expectedCount: requiredSignalIds.length, observedCount: returnedSignalIds.length, fieldPresent: true });
    }
    if (requiredSignalIds.some((signalId) => !parsed.summary_signal_ids.includes(signalId))) {
      return contractFailure({ reason: "The executive summary must synthesize every required highest-priority finding.", reasonCode: "executive_summary_signal_coverage_failed", stage: "ranked_signal_coverage", expectedField: "summary_signal_ids", expectedType: "array", observed: parsed.summary_signal_ids, expectedCount: requiredSignalIds.length, observedCount: parsed.summary_signal_ids.length, fieldPresent: true });
    }
  }

  const findingRanks = parsed.analysis.findings.map((finding) => earliestExecutiveRank(finding.citations, catalogById));
  if (findingRanks.some((rank, index) => index > 0 && rank < findingRanks[index - 1])) {
    return contractFailure({ reason: "Executive findings must remain ordered by verified signal priority.", reasonCode: "contextual_validation_failed", stage: "ranked_signal_coverage", expectedField: "analysis.findings", expectedType: "array", observed: parsed.analysis.findings, fieldPresent: true });
  }

  let crossSignalRelationshipFound = false;
  for (const relationship of parsed.analysis.relationships) {
    const left = findingsById.get(relationship.finding_ids[0]);
    const right = findingsById.get(relationship.finding_ids[1]);
    if (!left || !right) return contractFailure({ reason: "A relationship references a finding that was not returned.", reasonCode: "invalid_relationship", stage: "relationship_support", expectedField: "analysis.relationships[].finding_ids", expectedType: "array", observed: relationship.finding_ids, fieldPresent: true });
    if (!allowedRelationshipPair(left.signal_id, right.signal_id, signalPolicy?.relationships)) {
      return contractFailure({ reason: "A relationship was not present in the supplied signal relationship plan.", reasonCode: "unsupported_relationship", stage: "relationship_support", expectedField: "analysis.relationships[].finding_ids", expectedType: "array", observed: relationship.finding_ids, fieldPresent: true });
    }
    const citedSignals = signalIdsForCitations(relationship.citations, catalogById);
    if (!citedSignals.has(left.signal_id) || !citedSignals.has(right.signal_id)) {
      return contractFailure({ reason: "A cross-signal relationship must retain citations from both findings.", reasonCode: "unsupported_relationship", stage: "relationship_support", expectedField: "analysis.relationships[].citations", expectedType: "array", observed: relationship.citations, fieldPresent: true });
    }
    const sourceCount = independentSourceKeysForCitations(relationship.citations, catalogById).size;
    const currentSourceCount = independentSourceKeysForCitations(relationship.citations, catalogById, true).size;
    if (relationship.status === "Supported" && currentSourceCount < 2) {
      return contractFailure({ reason: "A supported relationship requires at least two independent current original sources.", reasonCode: "unsupported_relationship", stage: "relationship_support", expectedField: "analysis.relationships[].citations", expectedType: "array", observed: relationship.citations, expectedCount: 2, observedCount: currentSourceCount, fieldPresent: true });
    }
    if (relationship.status === "Possible" && sourceCount < 1) {
      return contractFailure({ reason: "A possible relationship must cite eligible original evidence.", reasonCode: "unsupported_relationship", stage: "relationship_support", expectedField: "analysis.relationships[].citations", expectedType: "array", observed: relationship.citations, expectedCount: 1, observedCount: sourceCount, fieldPresent: true });
    }
    crossSignalRelationshipFound = true;
  }
  if (signalPolicy?.requireCrossSignalAssessment && !crossSignalRelationshipFound) {
    return contractFailure({ reason: "The executive analysis must evaluate at least one supplied relationship between distinct signals.", reasonCode: "invalid_relationship", stage: "relationship_support", expectedField: "analysis.relationships", expectedType: "array", observed: parsed.analysis.relationships, expectedCount: 1, observedCount: parsed.analysis.relationships.length, fieldPresent: true });
  }

  for (const action of parsed.analysis.actions) {
    const sourceCount = independentSourceKeysForCitations(action.citations, catalogById).size;
    if (parsed.analysis.evidence_sufficiency !== "Insufficient" && sourceCount < 1) {
      return contractFailure({ reason: "Every recommendation must trace to eligible original evidence.", reasonCode: "invalid_action", stage: "citation_provenance", expectedField: "analysis.actions[].citations", expectedType: "array", observed: action.citations, expectedCount: 1, observedCount: sourceCount, fieldPresent: true });
    }
  }

  const decisionCitations = decisionCitationIds(parsed);
  const independentSourceCount = independentSourceKeysForCitations(decisionCitations, catalogById).size;
  const currentIndependentSourceCount = independentSourceKeysForCitations(decisionCitations, catalogById, true).size;
  const originalSourceTypeCount = originalSourceTypesForCitations(decisionCitations, catalogById).size;
  const sufficiency = parsed.analysis.evidence_sufficiency;

  if (sufficiency === "Sufficient" && (currentIndependentSourceCount < 2 || originalSourceTypeCount < 2)) {
    return contractFailure({ reason: "Sufficient evidence requires two current independent original sources across more than one source type.", reasonCode: "evidence_sufficiency_invalid", stage: "contextual_validation", expectedField: "analysis.evidence_sufficiency", expectedType: "string", observed: sufficiency, expectedCount: 2, observedCount: Math.min(currentIndependentSourceCount, originalSourceTypeCount), fieldPresent: true });
  }
  if (sufficiency === "Partial" && independentSourceCount < 1) {
    return contractFailure({ reason: "Partial evidence requires at least one eligible original source.", reasonCode: "evidence_sufficiency_invalid", stage: "contextual_validation", expectedField: "analysis.evidence_sufficiency", expectedType: "string", observed: sufficiency, expectedCount: 1, observedCount: independentSourceCount, fieldPresent: true });
  }
  if (sufficiency === "Conflicting" && independentSourceCount < 2) {
    return contractFailure({ reason: "Conflicting evidence requires at least two independent original sources.", reasonCode: "evidence_sufficiency_invalid", stage: "contextual_validation", expectedField: "analysis.evidence_sufficiency", expectedType: "string", observed: sufficiency, expectedCount: 2, observedCount: independentSourceCount, fieldPresent: true });
  }
  const allowedOverallConfidence = cappedConfidence(
    parsed.overall_confidence,
    independentSourceCount,
    currentIndependentSourceCount,
    sufficiency,
    parsed.analysis.evidence_agreement
  );
  if (allowedOverallConfidence !== parsed.overall_confidence) {
    return contractFailure({ reason: "Overall confidence exceeds the cited evidence ceiling.", reasonCode: "confidence_ceiling_exceeded", stage: "confidence", expectedField: "overall_confidence", expectedType: "string", observed: parsed.overall_confidence, fieldPresent: true });
  }

  return { ok: true as const, value };
}

function canonicalReferences(
  citations: number[],
  catalogById: Map<number, ExecutiveCitationCatalogEntry>
): ExecutiveEvidenceReference[] {
  return Array.from(new Set(citations)).flatMap((citationId) => {
    const source = catalogById.get(citationId);
    return source
      ? [{ citationId, title: source.title, sourceType: source.sourceType, support: source.support || source.title }]
      : [];
  });
}

function evidenceCategory(source: ExecutiveCitationCatalogEntry): ExecutiveIntelligenceBriefing["supportingEvidence"][number]["category"] {
  const value = `${source.domain || ""} ${source.sourceType} ${source.title}`.toLowerCase();
  if (/business memory|learned knowledge/.test(value)) return "Business Memory";
  if (/historical|trend|snapshot/.test(value)) return "Historical Trends";
  if (/report|briefing|plan/.test(value)) return "Reports";
  if (/kpi|metric|measurement/.test(value)) return "KPIs";
  return "Documents";
}

function supportingEvidenceGroups(
  parsed: ParsedExecutiveOutput,
  catalogById: Map<number, ExecutiveCitationCatalogEntry>
): ExecutiveIntelligenceBriefing["supportingEvidence"] {
  const categories: ExecutiveIntelligenceBriefing["supportingEvidence"][number]["category"][] = [
    "KPIs",
    "Business Memory",
    "Reports",
    "Documents",
    "Historical Trends"
  ];
  const usedCitationIds = Array.from(new Set(decisionCitationIds(parsed)));
  return categories.map((category) => ({
    category,
    items: canonicalReferences(
      usedCitationIds.filter((citationId) => {
        const source = catalogById.get(citationId);
        return source ? evidenceCategory(source) === category : false;
      }),
      catalogById
    )
  }));
}

function impactCategoryForFinding(finding: ParsedFinding, catalogById: Map<number, ExecutiveCitationCatalogEntry>) {
  const sourceText = finding.citations
    .map((citationId) => catalogById.get(citationId))
    .filter((item): item is ExecutiveCitationCatalogEntry => Boolean(item))
    .map((item) => `${item.domain || ""} ${item.sourceType} ${item.title}`)
    .join(" ")
    .toLowerCase();
  if (/financial|revenue|profit|margin|cash|cost|invoice|sales/.test(sourceText)) return "financial" as const;
  if (/customer|retention|return|complaint|feedback/.test(sourceText)) return "customer" as const;
  if (/operation|inventory|order|supplier|vendor|employee|people|capacity/.test(sourceText)) return "operational" as const;
  return "strategic" as const;
}

function derivedBusinessImpact(
  findings: ParsedFinding[],
  catalogById: Map<number, ExecutiveCitationCatalogEntry>
): ExecutiveIntelligenceBriefing["businessImpact"] {
  const grouped: Record<"financial" | "operational" | "customer" | "strategic", string[]> = {
    financial: [],
    operational: [],
    customer: [],
    strategic: []
  };
  findings.forEach((finding) => grouped[impactCategoryForFinding(finding, catalogById)].push(finding.impact));
  const value = (items: string[]) => Array.from(new Set(items)).join(" ") || "Not established from the cited evidence.";
  return {
    financial: value(grouped.financial),
    operational: value(grouped.operational),
    customer: value(grouped.customer),
    strategic: value(grouped.strategic),
    ifIgnored: findings[0]?.impact || "Not established from the cited evidence."
  };
}

function evidenceReadinessSummary(
  sufficiency: ExecutiveEvidenceSufficiency,
  independentSourceCount: number,
  currentIndependentSourceCount: number,
  sourceTypeCount: number
) {
  return `${independentSourceCount} independent eligible original source${independentSourceCount === 1 ? "" : "s"} support this analysis; ${currentIndependentSourceCount} are current across ${sourceTypeCount} source type${sourceTypeCount === 1 ? "" : "s"}. Evidence sufficiency is ${sufficiency.toLowerCase()}.`;
}

function actionConfidence(
  action: ParsedAction,
  parsed: ParsedExecutiveOutput,
  catalogById: Map<number, ExecutiveCitationCatalogEntry>
) {
  return cappedConfidence(
    parsed.overall_confidence,
    independentSourceKeysForCitations(action.citations, catalogById).size,
    independentSourceKeysForCitations(action.citations, catalogById, true).size,
    parsed.analysis.evidence_sufficiency,
    parsed.analysis.evidence_agreement
  );
}

export function executiveAnswerFromOutput({
  output,
  catalog,
  fallback
}: {
  output: Json;
  catalog: ExecutiveCitationCatalogEntry[];
  fallback: GlobalSearchAnswer;
}): GlobalSearchAnswer {
  const parsed = parsedExecutiveOutput(output);
  if (!parsed) return fallback;

  const catalogById = new Map(catalog.map((item) => [item.citationId, item]));
  const decisionCitations = decisionCitationIds(parsed);
  const independentSourceCount = independentSourceKeysForCitations(decisionCitations, catalogById).size;
  const currentIndependentSourceCount = independentSourceKeysForCitations(decisionCitations, catalogById, true).size;
  const originalSourceTypeCount = originalSourceTypesForCitations(decisionCitations, catalogById).size;
  const sufficiency = parsed.analysis.evidence_sufficiency;
  const confidence = cappedConfidence(
    parsed.overall_confidence,
    independentSourceCount,
    currentIndependentSourceCount,
    sufficiency,
    parsed.analysis.evidence_agreement
  );
  const confidenceExplanation = evidenceReadinessSummary(
    sufficiency,
    independentSourceCount,
    currentIndependentSourceCount,
    originalSourceTypeCount
  );
  const findingsById = new Map(parsed.analysis.findings.map((finding) => [finding.id, finding]));
  const supportingEvidence = supportingEvidenceGroups(parsed, catalogById);
  const firstAction = parsed.analysis.actions[0];
  const firstUncertainty = parsed.analysis.uncertainty[0] || "No additional uncertainty was stated in the validated analysis.";
  const highestFreshness = [...catalog].sort((left, right) => right.freshnessScore - left.freshnessScore || left.citationId - right.citationId)[0];
  const highestRelevance = [...catalog].sort((left, right) => right.directRelevanceScore - left.directRelevanceScore || left.citationId - right.citationId)[0];

  const executiveBriefing: ExecutiveIntelligenceBriefing = {
    variant: sufficiency === "Sufficient" ? "full" : "limited",
    evidenceSufficiency: { state: sufficiency, explanation: confidenceExplanation },
    executiveSummary: parsed.executive_summary,
    keyFindings: parsed.analysis.findings.map((finding) => ({
      finding: finding.finding,
      businessImpact: finding.impact,
      confidence: finding.confidence,
      evidence: canonicalReferences(finding.citations, catalogById)
    })),
    rootCauseAnalysis: parsed.analysis.relationships.map((relationship) => ({
      finding: relationship.finding_ids
        .map((findingId) => findingsById.get(findingId)?.finding)
        .filter((item): item is string => Boolean(item))
        .join(" / "),
      analysis: relationship.assessment,
      status: relationship.status,
      evidence: canonicalReferences(relationship.citations, catalogById)
    })),
    businessImpact: derivedBusinessImpact(parsed.analysis.findings, catalogById),
    recommendedActions: parsed.analysis.actions.map((action) => ({
      action: action.action,
      priority: action.priority,
      expectedBusinessImpact: action.outcome,
      urgency: `${action.priority} priority; ${action.horizon.toLowerCase()} horizon.`,
      expectedOutcome: action.outcome,
      timeHorizon: action.horizon,
      confidence: actionConfidence(action, parsed, catalogById),
      whyPrioritized: action.why,
      wouldChangeIf: firstUncertainty,
      evidence: canonicalReferences(action.citations, catalogById)
    })),
    supportingEvidence,
    confidenceAssessment: {
      level: confidence,
      explanation: confidenceExplanation,
      supportingSourceCount: independentSourceCount,
      evidenceAgreement: parsed.analysis.evidence_agreement,
      conflicts: parsed.analysis.evidence_agreement === "Conflicting" ? parsed.analysis.uncertainty : [],
      uncertainty: parsed.analysis.uncertainty
    },
    missingInformation: parsed.analysis.uncertainty,
    limitedEvidence: sufficiency === "Sufficient"
      ? undefined
      : {
          evidenceReadinessSummary: confidenceExplanation,
          provisionalInterpretations: parsed.analysis.findings.map((finding) => ({
            statement: finding.finding,
            evidence: canonicalReferences(finding.citations, catalogById)
          })),
          alternativeExplanations: parsed.analysis.relationships
            .filter((relationship) => relationship.status !== "Supported")
            .map((relationship) => ({
              statement: relationship.assessment,
              evidence: canonicalReferences(relationship.citations, catalogById)
            })),
          conflictAssessment: sufficiency === "Conflicting"
            ? {
                conflictSummary: parsed.analysis.uncertainty.join(" "),
                fresherSource: highestFreshness?.title || "Not established",
                moreDirectSource: highestRelevance?.title || "Not established",
                derivedSourceLimitations: "Derived and supporting records do not increase independent-source confidence.",
                resolutionAction: firstAction?.action || firstUncertainty
              }
            : undefined,
          leadershipRisk: parsed.analysis.findings[0]?.impact || "Not established from the cited evidence.",
          decisionsToDefer: parsed.analysis.uncertainty
        },
    leadershipBrief: {
      priorities: parsed.analysis.actions.map((action) => action.action),
      firstLeadershipMeeting: firstAction?.action || firstUncertainty,
      biggestDecision: firstAction?.action || firstUncertainty,
      biggestOpportunity: firstAction?.outcome || "Not established from the cited evidence.",
      biggestUnknown: firstUncertainty
    }
  };

  return {
    kind: "business_answer",
    directAnswer: executiveBriefing.executiveSummary,
    recommendationConfidence: confidence,
    evidenceNote: confidenceExplanation,
    executiveBriefing
  };
}
