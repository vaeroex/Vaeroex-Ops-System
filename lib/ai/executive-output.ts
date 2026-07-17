import "server-only";

import { z } from "zod";
import type {
  ExecutiveConfidence,
  ExecutiveEvidenceSufficiency,
  ExecutiveEvidenceReference,
  ExecutiveIntelligenceBriefing,
  GlobalSearchAnswer
} from "@/lib/search/types";
import type { Json } from "@/lib/supabase/types";

const confidenceSchema = z.enum(["High", "Medium", "Low", "Insufficient"]);
const evidenceSufficiencySchema = z.enum(["Sufficient", "Partial", "Conflicting", "Insufficient"]);
const evidenceReferenceSchema = z.object({
  citation_id: z.number().int().positive(),
  support: z.string().trim().min(1).max(600)
});
const evidenceReferencesSchema = z.array(evidenceReferenceSchema).max(5);
const findingIdSchema = z.string().regex(/^F[1-3]$/);
const causeIdSchema = z.string().regex(/^C[1-3]$/);
const actionIdSchema = z.string().regex(/^A[1-3]$/);
const causalStatusSchema = z.enum(["Supported", "Possible", "Not established"]);

const executiveReasoningStageSchema = z.object({
  evidence_sufficiency: z.object({
    state: evidenceSufficiencySchema,
    explanation: z.string().trim().min(1).max(900)
  }),
  what_is_happening: z.array(z.object({
    finding_id: findingIdSchema,
    conclusion: z.string().trim().min(1).max(700),
    evidence_references: evidenceReferencesSchema
  })).max(3),
  why_it_is_happening: z.array(z.object({
    cause_id: causeIdSchema,
    conclusion: z.string().trim().min(1).max(900),
    status: causalStatusSchema,
    evidence_references: evidenceReferencesSchema
  })).max(3),
  why_leadership_should_care: z.object({
    conclusion: z.string().trim().min(1).max(900),
    evidence_references: evidenceReferencesSchema
  }),
  what_should_happen_next: z.array(z.object({
    action_id: actionIdSchema,
    action: z.string().trim().min(1).max(700),
    evidence_references: evidenceReferencesSchema
  })).min(1).max(3),
  priority_logic: z.object({
    ordered_action_ids: z.array(actionIdSchema).min(1).max(3),
    explanation: z.string().trim().min(1).max(900)
  })
});

const executiveIntelligenceOutputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  reasoning_stage: executiveReasoningStageSchema,
  executive_summary: z.string().trim().min(1).max(1_500),
  key_findings: z.array(z.object({
    reasoning_finding_id: findingIdSchema,
    finding: z.string().trim().min(1).max(500),
    business_impact: z.string().trim().min(1).max(700),
    confidence: confidenceSchema,
    evidence_references: evidenceReferencesSchema.min(1)
  })).max(3),
  root_cause_analysis: z.array(z.object({
    reasoning_cause_id: causeIdSchema,
    finding: z.string().trim().min(1).max(500),
    analysis: z.string().trim().min(1).max(1_000),
    status: causalStatusSchema,
    evidence_references: evidenceReferencesSchema
  })).max(3),
  business_impact: z.object({
    financial: z.string().trim().min(1).max(700),
    operational: z.string().trim().min(1).max(700),
    customer: z.string().trim().min(1).max(700),
    strategic: z.string().trim().min(1).max(700),
    if_ignored: z.string().trim().min(1).max(700),
    evidence_references: evidenceReferencesSchema
  }),
  recommended_actions: z.array(z.object({
    reasoning_action_id: actionIdSchema,
    action: z.string().trim().min(1).max(500),
    priority: z.enum(["Critical", "High", "Medium", "Low"]),
    expected_business_impact: z.string().trim().min(1).max(700),
    urgency: z.string().trim().min(1).max(400),
    expected_outcome: z.string().trim().min(1).max(700),
    time_horizon: z.enum(["Immediate", "30 Days", "90 Days", "Long-Term"]),
    confidence: confidenceSchema,
    why_prioritized: z.string().trim().min(1).max(700),
    would_change_if: z.string().trim().min(1).max(700),
    evidence_references: evidenceReferencesSchema
  })).min(1).max(3),
  supporting_evidence: z.object({
    kpis: evidenceReferencesSchema,
    business_memory: evidenceReferencesSchema,
    reports: evidenceReferencesSchema,
    documents: evidenceReferencesSchema,
    historical_trends: evidenceReferencesSchema
  }),
  confidence_assessment: z.object({
    level: confidenceSchema,
    explanation: z.string().trim().min(1).max(900),
    supporting_source_count: z.number().int().nonnegative(),
    evidence_agreement: z.enum(["Aligned", "Mixed", "Conflicting", "Insufficient"]),
    conflicts: z.array(z.string().trim().min(1).max(500)).max(5),
    uncertainty: z.array(z.string().trim().min(1).max(500)).max(5)
  }),
  missing_information: z.array(z.string().trim().min(1).max(500)).max(5),
  limited_evidence: z.object({
    evidence_readiness_summary: z.string().trim().min(1).max(900),
    provisional_interpretations: z.array(z.object({
      statement: z.string().trim().min(1).max(700),
      evidence_references: evidenceReferencesSchema.min(1)
    })).max(3),
    alternative_explanations: z.array(z.object({
      statement: z.string().trim().min(1).max(700),
      evidence_references: evidenceReferencesSchema.min(1)
    })).max(3),
    conflict_resolution: z.object({
      conflict_summary: z.string().trim().min(1).max(700),
      fresher_source: z.string().trim().min(1).max(500),
      more_direct_source: z.string().trim().min(1).max(500),
      derived_source_limitations: z.string().trim().min(1).max(500),
      resolution_action: z.string().trim().min(1).max(700)
    }).nullable(),
    leadership_risk: z.string().trim().min(1).max(900),
    decisions_to_defer: z.array(z.string().trim().min(1).max(500)).max(3)
  }).nullable(),
  leadership_brief: z.object({
    priorities: z.array(z.string().trim().min(1).max(500)).length(3),
    first_leadership_meeting: z.string().trim().min(1).max(700),
    biggest_decision: z.string().trim().min(1).max(700),
    biggest_opportunity: z.string().trim().min(1).max(700),
    biggest_unknown: z.string().trim().min(1).max(700)
  })
}).superRefine((value, context) => {
  const sufficiency = value.reasoning_stage.evidence_sufficiency.state;
  const findingsById = new Map(value.reasoning_stage.what_is_happening.map((item) => [item.finding_id, item]));
  const causesById = new Map(value.reasoning_stage.why_it_is_happening.map((item) => [item.cause_id, item]));
  const actionsById = new Map(value.reasoning_stage.what_should_happen_next.map((item) => [item.action_id, item]));
  const orderedActionIds = value.reasoning_stage.priority_logic.ordered_action_ids;
  const expectedActionIds = Array.from(actionsById.keys());

  if (findingsById.size !== value.reasoning_stage.what_is_happening.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["reasoning_stage", "what_is_happening"], message: "Reasoning finding IDs must be unique." });
  }
  if (causesById.size !== value.reasoning_stage.why_it_is_happening.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["reasoning_stage", "why_it_is_happening"], message: "Reasoning cause IDs must be unique." });
  }
  if (actionsById.size !== value.reasoning_stage.what_should_happen_next.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["reasoning_stage", "what_should_happen_next"], message: "Reasoning action IDs must be unique." });
  }
  if (
    new Set(orderedActionIds).size !== orderedActionIds.length ||
    orderedActionIds.length !== expectedActionIds.length ||
    expectedActionIds.some((id) => !orderedActionIds.includes(id))
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["reasoning_stage", "priority_logic", "ordered_action_ids"],
      message: "Priority logic must rank every reasoned action exactly once."
    });
  }

  if (sufficiency === "Sufficient") {
    if (!value.key_findings.length || !value.root_cause_analysis.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reasoning_stage", "evidence_sufficiency", "state"],
        message: "Sufficient evidence requires a complete executive briefing with findings and causal analysis."
      });
    }
    if (value.limited_evidence !== null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["limited_evidence"], message: "A sufficient briefing must not include the limited-evidence variant." });
    }
  } else if (!value.limited_evidence) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["limited_evidence"], message: "Partial, conflicting, and insufficient evidence require the limited-evidence briefing." });
  } else if (!value.limited_evidence.decisions_to_defer.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["limited_evidence", "decisions_to_defer"], message: "A limited-evidence briefing must identify at least one decision that should wait." });
  }

  if (sufficiency !== "Sufficient" && value.confidence_assessment.level === "High") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["confidence_assessment", "level"],
      message: "High briefing confidence is not allowed when evidence is partial, conflicting, or insufficient."
    });
  }

  if (sufficiency === "Insufficient" && value.recommended_actions.some((item) => item.confidence === "High" || item.confidence === "Medium")) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["recommended_actions"],
      message: "Insufficient evidence permits only Low or Insufficient recommendation confidence."
    });
  }

  if (sufficiency === "Conflicting" && value.confidence_assessment.evidence_agreement !== "Conflicting") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["confidence_assessment", "evidence_agreement"],
      message: "Conflicting sufficiency must retain a conflicting evidence assessment."
    });
  }
  if (sufficiency === "Conflicting" && !value.limited_evidence?.conflict_resolution) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["limited_evidence", "conflict_resolution"],
      message: "Conflicting evidence requires a source-quality comparison and a resolution action."
    });
  }

  value.key_findings.forEach((item, index) => {
    const reasoning = findingsById.get(item.reasoning_finding_id);
    const reasoningCitations = new Set(reasoning?.evidence_references.map((reference) => reference.citation_id) || []);
    if (!reasoning) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["key_findings", index, "reasoning_finding_id"], message: "Every visible finding must come from the completed reasoning stage." });
    } else if (reasoningCitations.size && !item.evidence_references.some((reference) => reasoningCitations.has(reference.citation_id))) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["key_findings", index, "evidence_references"], message: "A visible finding must retain evidence used in its reasoning conclusion." });
    }
  });

  value.root_cause_analysis.forEach((item, index) => {
    const reasoning = causesById.get(item.reasoning_cause_id);
    const citationCount = new Set(item.evidence_references.map((reference) => reference.citation_id)).size;

    if (!reasoning) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["root_cause_analysis", index, "reasoning_cause_id"], message: "Every visible root cause must come from the completed reasoning stage." });
    } else {
      const reasoningCitations = new Set(reasoning.evidence_references.map((reference) => reference.citation_id));
      if (reasoning.status !== item.status) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["root_cause_analysis", index, "status"], message: "Root-cause certainty cannot change after the reasoning stage." });
      }
      if (item.evidence_references.length && !item.evidence_references.some((reference) => reasoningCitations.has(reference.citation_id))) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["root_cause_analysis", index, "evidence_references"], message: "A visible root cause must retain evidence used in its reasoning conclusion." });
      }
    }

    if (item.status === "Supported" && citationCount < 2) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["root_cause_analysis", index, "evidence_references"],
        message: "A supported root cause must correlate at least two evidence references."
      });
    }

    if (item.status === "Possible" && citationCount < 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["root_cause_analysis", index, "evidence_references"],
        message: "A possible root cause must cite the evidence that makes it plausible."
      });
    }
  });

  value.recommended_actions.forEach((item, index) => {
    const reasoning = actionsById.get(item.reasoning_action_id);
    const reasoningCitations = new Set(reasoning?.evidence_references.map((reference) => reference.citation_id) || []);
    if (!reasoning) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["recommended_actions", index, "reasoning_action_id"], message: "Every recommendation must come from the completed reasoning stage." });
    } else if (reasoningCitations.size && !item.evidence_references.some((reference) => reasoningCitations.has(reference.citation_id))) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["recommended_actions", index, "evidence_references"], message: "A recommendation must retain evidence used to prioritize it." });
    }

    if (sufficiency !== "Insufficient" && item.evidence_references.length === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["recommended_actions", index, "evidence_references"], message: "Recommendations require supporting evidence unless the workspace has no sufficient business evidence." });
    }
  });

  if (value.confidence_assessment.level !== "High" && value.missing_information.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["missing_information"],
      message: "Non-High confidence requires the missing information that would improve the decision."
    });
  }

  if (value.confidence_assessment.evidence_agreement === "Conflicting" && value.confidence_assessment.conflicts.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["confidence_assessment", "conflicts"],
      message: "Conflicting evidence must identify the conflict."
    });
  }
});

export type ExecutiveCitationCatalogEntry = {
  citationId: number;
  title: string;
  sourceType: string;
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
};

type ParsedExecutiveOutput = z.infer<typeof executiveIntelligenceOutputSchema>;

export function validateExecutiveIntelligenceContract(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const keys = Object.keys(value);
    const reasoningIndex = keys.indexOf("reasoning_stage");
    const summaryIndex = keys.indexOf("executive_summary");
    if (reasoningIndex < 0 || summaryIndex < 0 || reasoningIndex > summaryIndex) {
      return {
        ok: false as const,
        reason: "The decision-analysis stage must be completed before the executive response is written."
      };
    }
  }

  const parsed = executiveIntelligenceOutputSchema.safeParse(value);

  return parsed.success
    ? { ok: true as const, value: parsed.data as Json }
    : {
        ok: false as const,
        reason: parsed.error.issues[0]?.message || "The executive response did not match its contract."
      };
}

function parsedExecutiveOutput(value: unknown): ParsedExecutiveOutput | null {
  const parsed = executiveIntelligenceOutputSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function decisionEvidenceReferences(value: ParsedExecutiveOutput) {
  const limitedReferences = value.limited_evidence
    ? [
        ...value.limited_evidence.provisional_interpretations.flatMap((item) => item.evidence_references),
        ...value.limited_evidence.alternative_explanations.flatMap((item) => item.evidence_references)
      ]
    : [];

  return [
    ...value.reasoning_stage.what_is_happening.flatMap((item) => item.evidence_references),
    ...value.reasoning_stage.why_it_is_happening.flatMap((item) => item.evidence_references),
    ...value.reasoning_stage.why_leadership_should_care.evidence_references,
    ...value.reasoning_stage.what_should_happen_next.flatMap((item) => item.evidence_references),
    ...value.key_findings.flatMap((item) => item.evidence_references),
    ...value.root_cause_analysis.flatMap((item) => item.evidence_references),
    ...value.business_impact.evidence_references,
    ...value.recommended_actions.flatMap((item) => item.evidence_references),
    ...limitedReferences
  ];
}

function allEvidenceReferences(value: ParsedExecutiveOutput) {
  return [
    ...decisionEvidenceReferences(value),
    ...Object.values(value.supporting_evidence).flat()
  ];
}

function usedIndependentSourceKeys(
  value: ParsedExecutiveOutput,
  catalogById: Map<number, ExecutiveCitationCatalogEntry>,
  currentOnly = false
) {
  return new Set(
    decisionEvidenceReferences(value)
      .map((reference) => catalogById.get(reference.citation_id))
      .filter(
        (item): item is ExecutiveCitationCatalogEntry =>
          item !== undefined && item.evidenceRole === "original" && (!currentOnly || item.freshnessScore >= 60)
      )
      .map((item) => item.independentSourceKey)
      .filter((key): key is string => Boolean(key))
  );
}

function usedOriginalSourceTypes(
  value: ParsedExecutiveOutput,
  catalogById: Map<number, ExecutiveCitationCatalogEntry>
) {
  return new Set(
    decisionEvidenceReferences(value)
      .map((reference) => catalogById.get(reference.citation_id))
      .filter((item): item is ExecutiveCitationCatalogEntry => item !== undefined && item.evidenceRole === "original")
      .map((item) => item.sourceType)
  );
}

function independentSourceCountForReferences(
  references: Array<{ citation_id: number }>,
  catalogById: Map<number, ExecutiveCitationCatalogEntry>,
  currentOnly = false
) {
  return new Set(
    references
      .map((reference) => catalogById.get(reference.citation_id))
      .filter(
        (item): item is ExecutiveCitationCatalogEntry =>
          item !== undefined && item.evidenceRole === "original" && (!currentOnly || item.freshnessScore >= 60)
      )
      .map((item) => item.independentSourceKey)
      .filter((key): key is string => Boolean(key))
  ).size;
}

function signalIdsForReferences(
  references: Array<{ citation_id: number }>,
  catalogById: Map<number, ExecutiveCitationCatalogEntry>
) {
  return new Set(
    references
      .map((reference) => catalogById.get(reference.citation_id))
      .filter((item): item is ExecutiveCitationCatalogEntry => Boolean(item?.signalId) && item?.findingEligible === true)
      .map((item) => item.signalId as string)
  );
}

function maximumDistinctFindingCoverage(signalSets: Set<string>[]) {
  const signalAssignments = new Map<string, number>();

  function assign(findingIndex: number, visited: Set<string>): boolean {
    for (const signalId of signalSets[findingIndex]) {
      if (visited.has(signalId)) continue;
      visited.add(signalId);
      const assignedFinding = signalAssignments.get(signalId);
      if (assignedFinding === undefined || assign(assignedFinding, visited)) {
        signalAssignments.set(signalId, findingIndex);
        return true;
      }
    }
    return false;
  }

  let matched = 0;
  signalSets.forEach((_, findingIndex) => {
    if (assign(findingIndex, new Set())) matched += 1;
  });
  return matched;
}

function earliestExecutiveRank(
  references: Array<{ citation_id: number }>,
  catalogById: Map<number, ExecutiveCitationCatalogEntry>
) {
  const ranks = references
    .map((reference) => catalogById.get(reference.citation_id)?.executiveRank)
    .filter((rank): rank is number => typeof rank === "number");
  return ranks.length ? Math.min(...ranks) : Number.POSITIVE_INFINITY;
}

export function validateExecutiveEvidenceReferences(
  value: Json,
  catalog: ExecutiveCitationCatalogEntry[],
  signalPolicy?: ExecutiveSignalValidationPolicy
) {
  const parsed = parsedExecutiveOutput(value);
  if (!parsed) return { ok: false as const, reason: "The executive response did not match its contract." };

  const catalogById = new Map(catalog.map((item) => [item.citationId, item]));
  const unknownReference = allEvidenceReferences(parsed).find((reference) => !catalogById.has(reference.citation_id));

  if (unknownReference) {
    return {
      ok: false as const,
      reason: `Evidence reference ${unknownReference.citation_id} was not supplied to this request.`
    };
  }

  if (signalPolicy && signalPolicy.minimumDistinctFindings > 0) {
    const minimum = Math.min(3, signalPolicy.minimumDistinctFindings);
    const requiredSignalIds = new Set(signalPolicy.requiredSignalIds.slice(0, minimum));
    const reasoningSignalSets = parsed.reasoning_stage.what_is_happening.map((finding) =>
      signalIdsForReferences(finding.evidence_references, catalogById)
    );
    const visibleSignalSets = parsed.key_findings.map((finding) =>
      signalIdsForReferences(finding.evidence_references, catalogById)
    );
    const requiredReasoningSignalSets = reasoningSignalSets.map((signals) =>
      new Set(Array.from(signals).filter((signalId) => requiredSignalIds.has(signalId)))
    );
    const requiredVisibleSignalSets = visibleSignalSets.map((signals) =>
      new Set(Array.from(signals).filter((signalId) => requiredSignalIds.has(signalId)))
    );

    if (
      parsed.reasoning_stage.what_is_happening.length < minimum ||
      maximumDistinctFindingCoverage(requiredReasoningSignalSets) < minimum
    ) {
      return {
        ok: false as const,
        reason: `The reasoning stage must assess the ${minimum} highest-priority distinct evidence-backed signals before writing.`
      };
    }

    if (parsed.key_findings.length < minimum || maximumDistinctFindingCoverage(requiredVisibleSignalSets) < minimum) {
      return {
        ok: false as const,
        reason: `The executive briefing must retain the ${minimum} highest-priority distinct evidence-backed findings.`
      };
    }

    const leadingSignalId = signalPolicy.requiredSignalIds[0];
    if (leadingSignalId && !visibleSignalSets[0]?.has(leadingSignalId)) {
      return { ok: false as const, reason: "The first executive finding must retain the highest-priority supported signal." };
    }

    const visibleRanks = parsed.key_findings.map((finding) => earliestExecutiveRank(finding.evidence_references, catalogById));
    if (visibleRanks.some((rank, index) => index > 0 && rank < visibleRanks[index - 1])) {
      return { ok: false as const, reason: "Executive findings must remain ordered by verified signal priority." };
    }

    if (minimum >= 2) {
      const leadershipSignalCount = signalIdsForReferences(
        parsed.reasoning_stage.why_leadership_should_care.evidence_references,
        catalogById
      ).size;
      if (leadershipSignalCount < 2) {
        return { ok: false as const, reason: "Leadership relevance must synthesize more than the dominant signal." };
      }
    }

    if (signalPolicy.requireCrossSignalAssessment) {
      const relationshipAssessed = [
        ...parsed.reasoning_stage.why_it_is_happening,
        ...parsed.root_cause_analysis
      ].some((item) => signalIdsForReferences(item.evidence_references, catalogById).size >= 2);
      if (!relationshipAssessed) {
        return {
          ok: false as const,
          reason: "The executive reasoning stage must evaluate at least one relationship between distinct supported signals."
        };
      }
    }
  }

  const supportedCausalAssessments = [
    ...parsed.reasoning_stage.why_it_is_happening,
    ...parsed.root_cause_analysis
  ].filter((item) => item.status === "Supported");

  for (const rootCause of supportedCausalAssessments) {
    if (independentSourceCountForReferences(rootCause.evidence_references, catalogById, true) < 2) {
      return {
        ok: false as const,
        reason: "A supported root cause must correlate at least two independent current original sources."
      };
    }
  }

  for (const rootCause of parsed.root_cause_analysis) {
    if (
      rootCause.evidence_references.length > 0 &&
      independentSourceCountForReferences(rootCause.evidence_references, catalogById) < 1
    ) {
      return { ok: false as const, reason: "A causal assessment cannot rely only on derived or supporting context." };
    }
  }

  const independentSourceCount = usedIndependentSourceKeys(parsed, catalogById).size;
  const currentIndependentSourceCount = usedIndependentSourceKeys(parsed, catalogById, true).size;
  const originalSourceTypeCount = usedOriginalSourceTypes(parsed, catalogById).size;
  const sufficiency = parsed.reasoning_stage.evidence_sufficiency.state;

  for (const finding of parsed.key_findings) {
    if (independentSourceCountForReferences(finding.evidence_references, catalogById) < 1) {
      return { ok: false as const, reason: "Every business finding must trace to eligible original evidence." };
    }
  }

  for (const interpretation of [
    ...(parsed.limited_evidence?.provisional_interpretations || []),
    ...(parsed.limited_evidence?.alternative_explanations || [])
  ]) {
    if (independentSourceCountForReferences(interpretation.evidence_references, catalogById) < 1) {
      return { ok: false as const, reason: "Provisional and alternative interpretations must trace to eligible original evidence." };
    }
  }

  for (const action of parsed.recommended_actions) {
    const originalSourceCount = independentSourceCountForReferences(action.evidence_references, catalogById);
    if (action.evidence_references.length > 0 && originalSourceCount < 1) {
      return { ok: false as const, reason: "A recommendation cannot rely only on derived or supporting context." };
    }
    if (sufficiency !== "Insufficient" && originalSourceCount < 1) {
      return { ok: false as const, reason: "Every recommendation must trace to eligible original evidence." };
    }
  }

  if (parsed.confidence_assessment.supporting_source_count !== independentSourceCount) {
    return {
      ok: false as const,
      reason: "The confidence source count must equal the independent original sources actually cited in the response."
    };
  }

  if (sufficiency === "Sufficient" && currentIndependentSourceCount < 2) {
    return { ok: false as const, reason: "Sufficient evidence requires at least two independent current original sources." };
  }

  if (sufficiency === "Sufficient" && originalSourceTypeCount < 2) {
    return { ok: false as const, reason: "Sufficient evidence requires more than one original source type." };
  }

  if (sufficiency === "Partial" && independentSourceCount < 1) {
    return { ok: false as const, reason: "Partial evidence requires at least one original source." };
  }

  if (sufficiency === "Conflicting" && independentSourceCount < 2) {
    return { ok: false as const, reason: "Conflicting evidence requires at least two independent original sources." };
  }

  if (parsed.confidence_assessment.level === "High" && currentIndependentSourceCount < 3) {
    return {
      ok: false as const,
      reason: "High confidence requires at least three independent current original sources."
    };
  }

  return { ok: true as const, value };
}

const CONFIDENCE_RANK: Record<ExecutiveConfidence, number> = {
  Insufficient: 0,
  Low: 1,
  Medium: 2,
  High: 3
};

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
  evidenceAgreement: ParsedExecutiveOutput["confidence_assessment"]["evidence_agreement"]
): ExecutiveConfidence {
  let maximum = maximumConfidence(independentSourceCount, currentIndependentSourceCount);
  if (sufficiency === "Insufficient") maximum = independentSourceCount ? "Low" : "Insufficient";
  if ((sufficiency === "Partial" || sufficiency === "Conflicting") && maximum === "High") maximum = "Medium";
  if ((evidenceAgreement === "Mixed" || evidenceAgreement === "Conflicting") && maximum === "High") maximum = "Medium";
  return CONFIDENCE_RANK[requested] <= CONFIDENCE_RANK[maximum] ? requested : maximum;
}

function canonicalReferences(
  references: ParsedExecutiveOutput["key_findings"][number]["evidence_references"],
  catalogById: Map<number, ExecutiveCitationCatalogEntry>
): ExecutiveEvidenceReference[] {
  return references.flatMap((reference) => {
    const source = catalogById.get(reference.citation_id);
    return source
      ? [{
          citationId: source.citationId,
          title: source.title,
          sourceType: source.sourceType,
          support: reference.support
        }]
      : [];
  });
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
  const independentSourceCount = usedIndependentSourceKeys(parsed, catalogById).size;
  const currentIndependentSourceCount = usedIndependentSourceKeys(parsed, catalogById, true).size;
  const sufficiency = parsed.reasoning_stage.evidence_sufficiency.state;
  const modelConfidence = parsed.confidence_assessment.level;
  const confidence = cappedConfidence(
    modelConfidence,
    independentSourceCount,
    currentIndependentSourceCount,
    sufficiency,
    parsed.confidence_assessment.evidence_agreement
  );
  const confidenceExplanation = confidence === modelConfidence
    ? parsed.confidence_assessment.explanation
    : `${parsed.confidence_assessment.explanation} Recommendation confidence is capped at ${confidence} because only ${currentIndependentSourceCount} of ${independentSourceCount} independent original source${independentSourceCount === 1 ? " is" : "s are"} current enough to support this decision.`;
  const supportingGroups: Array<{
    category: ExecutiveIntelligenceBriefing["supportingEvidence"][number]["category"];
    references: ParsedExecutiveOutput["supporting_evidence"][keyof ParsedExecutiveOutput["supporting_evidence"]];
  }> = [
    { category: "KPIs", references: parsed.supporting_evidence.kpis },
    { category: "Business Memory", references: parsed.supporting_evidence.business_memory },
    { category: "Reports", references: parsed.supporting_evidence.reports },
    { category: "Documents", references: parsed.supporting_evidence.documents },
    { category: "Historical Trends", references: parsed.supporting_evidence.historical_trends }
  ];

  const executiveBriefing: ExecutiveIntelligenceBriefing = {
    variant: sufficiency === "Sufficient" ? "full" : "limited",
    evidenceSufficiency: {
      state: sufficiency,
      explanation: parsed.reasoning_stage.evidence_sufficiency.explanation
    },
    executiveSummary: parsed.executive_summary,
    keyFindings: parsed.key_findings.map((item) => ({
      finding: item.finding,
      businessImpact: item.business_impact,
      confidence: cappedConfidence(
        item.confidence,
        independentSourceCountForReferences(item.evidence_references, catalogById),
        independentSourceCountForReferences(item.evidence_references, catalogById, true),
        sufficiency,
        parsed.confidence_assessment.evidence_agreement
      ),
      evidence: canonicalReferences(item.evidence_references, catalogById)
    })),
    rootCauseAnalysis: parsed.root_cause_analysis.map((item) => ({
      finding: item.finding,
      analysis: item.analysis,
      status: item.status,
      evidence: canonicalReferences(item.evidence_references, catalogById)
    })),
    businessImpact: {
      financial: parsed.business_impact.financial,
      operational: parsed.business_impact.operational,
      customer: parsed.business_impact.customer,
      strategic: parsed.business_impact.strategic,
      ifIgnored: parsed.business_impact.if_ignored
    },
    recommendedActions: parsed.recommended_actions.map((item) => ({
      action: item.action,
      priority: item.priority,
      expectedBusinessImpact: item.expected_business_impact,
      urgency: item.urgency,
      expectedOutcome: item.expected_outcome,
      timeHorizon: item.time_horizon,
      confidence: cappedConfidence(
        item.confidence,
        independentSourceCountForReferences(item.evidence_references, catalogById),
        independentSourceCountForReferences(item.evidence_references, catalogById, true),
        sufficiency,
        parsed.confidence_assessment.evidence_agreement
      ),
      whyPrioritized: item.why_prioritized,
      wouldChangeIf: item.would_change_if,
      evidence: canonicalReferences(item.evidence_references, catalogById)
    })),
    supportingEvidence: supportingGroups.map((group) => ({
      category: group.category,
      items: canonicalReferences(group.references, catalogById)
    })),
    confidenceAssessment: {
      level: confidence,
      explanation: confidenceExplanation,
      supportingSourceCount: independentSourceCount,
      evidenceAgreement: parsed.confidence_assessment.evidence_agreement,
      conflicts: parsed.confidence_assessment.conflicts,
      uncertainty: parsed.confidence_assessment.uncertainty
    },
    missingInformation: parsed.missing_information,
    limitedEvidence: parsed.limited_evidence
      ? {
          evidenceReadinessSummary: parsed.limited_evidence.evidence_readiness_summary,
          provisionalInterpretations: parsed.limited_evidence.provisional_interpretations.map((item) => ({
            statement: item.statement,
            evidence: canonicalReferences(item.evidence_references, catalogById)
          })),
          alternativeExplanations: parsed.limited_evidence.alternative_explanations.map((item) => ({
            statement: item.statement,
            evidence: canonicalReferences(item.evidence_references, catalogById)
          })),
          conflictAssessment: parsed.limited_evidence.conflict_resolution
            ? {
                conflictSummary: parsed.limited_evidence.conflict_resolution.conflict_summary,
                fresherSource: parsed.limited_evidence.conflict_resolution.fresher_source,
                moreDirectSource: parsed.limited_evidence.conflict_resolution.more_direct_source,
                derivedSourceLimitations: parsed.limited_evidence.conflict_resolution.derived_source_limitations,
                resolutionAction: parsed.limited_evidence.conflict_resolution.resolution_action
              }
            : undefined,
          leadershipRisk: parsed.limited_evidence.leadership_risk,
          decisionsToDefer: parsed.limited_evidence.decisions_to_defer
        }
      : undefined,
    leadershipBrief: {
      priorities: parsed.leadership_brief.priorities,
      firstLeadershipMeeting: parsed.leadership_brief.first_leadership_meeting,
      biggestDecision: parsed.leadership_brief.biggest_decision,
      biggestOpportunity: parsed.leadership_brief.biggest_opportunity,
      biggestUnknown: parsed.leadership_brief.biggest_unknown
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
