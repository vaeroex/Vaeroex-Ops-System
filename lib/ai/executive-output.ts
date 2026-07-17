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

export function validateExecutiveIntelligenceContract(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false as const, reason: "The executive response did not match its contract." };
  }

  const objectValue = value as Record<string, unknown>;
  if (!hasKeyOrder(objectValue, ["analysis", "executive_summary", "overall_confidence", "summary_signal_ids"])) {
    return { ok: false as const, reason: "Executive analysis must be completed before the summary is written." };
  }
  if (
    objectValue.analysis &&
    typeof objectValue.analysis === "object" &&
    !Array.isArray(objectValue.analysis) &&
    !hasKeyOrder(objectValue.analysis as Record<string, unknown>, [
      "evidence_sufficiency",
      "evidence_agreement",
      "findings",
      "relationships",
      "actions",
      "uncertainty"
    ])
  ) {
    return { ok: false as const, reason: "Executive reasoning stages were not returned in the required order." };
  }

  const parsed = executiveIntelligenceOutputSchema.safeParse(value);
  return parsed.success
    ? { ok: true as const, value: parsed.data as Json }
    : { ok: false as const, reason: parsed.error.issues[0]?.message || "The executive response did not match its contract." };
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
) {
  const parsed = parsedExecutiveOutput(value);
  if (!parsed) return { ok: false as const, reason: "The executive response did not match its contract." };

  const catalogById = new Map(catalog.map((item) => [item.citationId, item]));
  const unknownCitation = decisionCitationIds(parsed).find((citationId) => !catalogById.has(citationId));
  if (unknownCitation) {
    return { ok: false as const, reason: `Evidence reference ${unknownCitation} was not supplied to this request.` };
  }

  const findingsById = new Map(parsed.analysis.findings.map((finding) => [finding.id, finding]));
  for (const finding of parsed.analysis.findings) {
    const citationSignals = signalIdsForCitations(finding.citations, catalogById);
    if (!citationSignals.has(finding.signal_id)) {
      return { ok: false as const, reason: `Finding ${finding.id} is not supported by eligible citations for ${finding.signal_id}.` };
    }
    const sourceCount = independentSourceKeysForCitations(finding.citations, catalogById).size;
    const currentSourceCount = independentSourceKeysForCitations(finding.citations, catalogById, true).size;
    if (sourceCount < 1) {
      return { ok: false as const, reason: "Every business finding must trace to eligible original evidence." };
    }
    const allowedConfidence = cappedConfidence(
      finding.confidence,
      sourceCount,
      currentSourceCount,
      parsed.analysis.evidence_sufficiency,
      parsed.analysis.evidence_agreement
    );
    if (allowedConfidence !== finding.confidence) {
      return { ok: false as const, reason: `Finding ${finding.id} exceeds the confidence supported by its cited evidence.` };
    }
  }

  if (signalPolicy && signalPolicy.minimumDistinctFindings > 0) {
    const minimum = Math.min(3, signalPolicy.minimumDistinctFindings);
    const requiredSignalIds = signalPolicy.requiredSignalIds.slice(0, minimum);
    const returnedSignalIds = parsed.analysis.findings.slice(0, minimum).map((finding) => finding.signal_id);
    if (parsed.analysis.findings.length < minimum || requiredSignalIds.some((signalId, index) => returnedSignalIds[index] !== signalId)) {
      return { ok: false as const, reason: `The executive analysis must retain the ${minimum} highest-priority distinct evidence-backed findings in order.` };
    }
    if (requiredSignalIds.some((signalId) => !parsed.summary_signal_ids.includes(signalId))) {
      return { ok: false as const, reason: "The executive summary must synthesize every required highest-priority finding." };
    }
  }

  const findingRanks = parsed.analysis.findings.map((finding) => earliestExecutiveRank(finding.citations, catalogById));
  if (findingRanks.some((rank, index) => index > 0 && rank < findingRanks[index - 1])) {
    return { ok: false as const, reason: "Executive findings must remain ordered by verified signal priority." };
  }

  let crossSignalRelationshipFound = false;
  for (const relationship of parsed.analysis.relationships) {
    const left = findingsById.get(relationship.finding_ids[0]);
    const right = findingsById.get(relationship.finding_ids[1]);
    if (!left || !right) return { ok: false as const, reason: "A relationship references a finding that was not returned." };
    if (!allowedRelationshipPair(left.signal_id, right.signal_id, signalPolicy?.relationships)) {
      return { ok: false as const, reason: "A relationship was not present in the supplied signal relationship plan." };
    }
    const citedSignals = signalIdsForCitations(relationship.citations, catalogById);
    if (!citedSignals.has(left.signal_id) || !citedSignals.has(right.signal_id)) {
      return { ok: false as const, reason: "A cross-signal relationship must retain citations from both findings." };
    }
    const sourceCount = independentSourceKeysForCitations(relationship.citations, catalogById).size;
    const currentSourceCount = independentSourceKeysForCitations(relationship.citations, catalogById, true).size;
    if (relationship.status === "Supported" && currentSourceCount < 2) {
      return { ok: false as const, reason: "A supported relationship requires at least two independent current original sources." };
    }
    if (relationship.status === "Possible" && sourceCount < 1) {
      return { ok: false as const, reason: "A possible relationship must cite eligible original evidence." };
    }
    crossSignalRelationshipFound = true;
  }
  if (signalPolicy?.requireCrossSignalAssessment && !crossSignalRelationshipFound) {
    return { ok: false as const, reason: "The executive analysis must evaluate at least one supplied relationship between distinct signals." };
  }

  for (const action of parsed.analysis.actions) {
    const sourceCount = independentSourceKeysForCitations(action.citations, catalogById).size;
    if (parsed.analysis.evidence_sufficiency !== "Insufficient" && sourceCount < 1) {
      return { ok: false as const, reason: "Every recommendation must trace to eligible original evidence." };
    }
  }

  const decisionCitations = decisionCitationIds(parsed);
  const independentSourceCount = independentSourceKeysForCitations(decisionCitations, catalogById).size;
  const currentIndependentSourceCount = independentSourceKeysForCitations(decisionCitations, catalogById, true).size;
  const originalSourceTypeCount = originalSourceTypesForCitations(decisionCitations, catalogById).size;
  const sufficiency = parsed.analysis.evidence_sufficiency;

  if (sufficiency === "Sufficient" && (currentIndependentSourceCount < 2 || originalSourceTypeCount < 2)) {
    return { ok: false as const, reason: "Sufficient evidence requires two current independent original sources across more than one source type." };
  }
  if (sufficiency === "Partial" && independentSourceCount < 1) {
    return { ok: false as const, reason: "Partial evidence requires at least one eligible original source." };
  }
  if (sufficiency === "Conflicting" && independentSourceCount < 2) {
    return { ok: false as const, reason: "Conflicting evidence requires at least two independent original sources." };
  }
  const allowedOverallConfidence = cappedConfidence(
    parsed.overall_confidence,
    independentSourceCount,
    currentIndependentSourceCount,
    sufficiency,
    parsed.analysis.evidence_agreement
  );
  if (allowedOverallConfidence !== parsed.overall_confidence) {
    return { ok: false as const, reason: "Overall confidence exceeds the cited evidence ceiling." };
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
