import "server-only";

import type { BoundedWorkspaceContext } from "@/lib/ai/bounded-context";
import type { ExecutiveReasoningContext, RankedExecutiveEvidence } from "@/lib/ai/executive-intelligence";
import type {
  ExecutiveEvidenceReference,
  ExecutiveIntelligenceBriefing,
  GlobalSearchAnswer
} from "@/lib/search/types";
import type { Json } from "@/lib/supabase/types";

type JsonRecord = Record<string, Json | undefined>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function isBusinessHealthQuestion(query: string) {
  return /\b(business health|health score|health rating)\b/i.test(query);
}

function canonicalReference(
  item: RankedExecutiveEvidence,
  reasoningContext: ExecutiveReasoningContext,
  support: string
): ExecutiveEvidenceReference | null {
  const index = reasoningContext.rankedEvidence.findIndex((candidate) => candidate.key === item.key);
  if (index < 0) return null;
  return {
    citationId: index + 1,
    title: item.title,
    sourceType: item.sourceType,
    support
  };
}

function evidenceGroups(references: ExecutiveEvidenceReference[]): ExecutiveIntelligenceBriefing["supportingEvidence"] {
  const groups: ExecutiveIntelligenceBriefing["supportingEvidence"] = [
    { category: "KPIs", items: [] },
    { category: "Business Memory", items: [] },
    { category: "Reports", items: [] },
    { category: "Documents", items: [] },
    { category: "Historical Trends", items: [] }
  ];

  for (const reference of references) {
    const category = /kpi|metric/i.test(reference.sourceType)
      ? "KPIs"
      : /memory/i.test(reference.sourceType)
        ? "Business Memory"
        : /report/i.test(reference.sourceType)
          ? "Reports"
          : /histor|health/i.test(reference.sourceType)
            ? "Historical Trends"
            : "Documents";
    groups.find((group) => group.category === category)?.items.push(reference);
  }

  return groups;
}

function generalMissingInformation(query: string) {
  if (isBusinessHealthQuestion(query)) {
    return [
      "Current KPI actuals with confirmed targets and reporting dates",
      "The active risk and opportunity findings included in the latest score",
      "At least two current original source types that cover the operating areas being assessed"
    ];
  }
  if (/\b(risk|weakest|priority|priorities)\b/i.test(query)) {
    return [
      "Current KPI actuals and targets for the business areas being compared",
      "Recent operating, customer, and financial source records",
      "A second independent source for any signal leadership may act on"
    ];
  }
  return [
    "Current leadership KPIs with targets and reporting dates",
    "Recent operational and financial source records",
    "Independent evidence that confirms the scope and persistence of the leading signal"
  ];
}

function limitedActions({
  query,
  reference,
  evidence,
  healthContext
}: {
  query: string;
  reference: ExecutiveEvidenceReference | null;
  evidence: ExecutiveEvidenceReference[];
  healthContext: JsonRecord;
}): ExecutiveIntelligenceBriefing["recommendedActions"] {
  const kpiReadiness = record(healthContext.kpi_readiness);
  const missingTargets = numberValue(kpiReadiness.missing_targets) || 0;
  const staleMetrics = numberValue(kpiReadiness.stale_metrics) || 0;
  if (isBusinessHealthQuestion(query)) {
    return [
      {
        action: "Review the active risk and opportunity findings that feed the current Business Health score.",
        priority: "High",
        expectedBusinessImpact: "Separates operating problems that need intervention from limitations in how confidently the business can be assessed.",
        urgency: "The score should not drive an operating decision until leadership can see which current findings changed it.",
        expectedOutcome: "A short list of verified operating actions and a separate list of assessment-readiness actions.",
        timeHorizon: "Immediate",
        confidence: reference ? "Low" : "Insufficient",
        whyPrioritized: "This is the only safe way to improve operating performance without treating data completeness as performance.",
        wouldChangeIf: "A newer score snapshot or newly resolved risk materially changes the current score drivers.",
        evidence
      },
      {
        action: missingTargets || staleMetrics
          ? `Confirm ${missingTargets ? `${missingTargets} missing KPI target${missingTargets === 1 ? "" : "s"}` : "KPI targets"}${missingTargets && staleMetrics ? " and " : ""}${staleMetrics ? `refresh ${staleMetrics} stale metric${staleMetrics === 1 ? "" : "s"}` : ""}.`
          : "Confirm that KPI targets, reporting dates, and source freshness still reflect the current business.",
        priority: "Medium",
        expectedBusinessImpact: "Improves the reliability of the assessment without claiming that business performance has improved.",
        urgency: "Missing targets and stale measurements can make the score less decision-useful.",
        expectedOutcome: "A more reliable performance baseline for the next Business Health review.",
        timeHorizon: "30 Days",
        confidence: "Low",
        whyPrioritized: "This addresses measurement readiness after leadership reviews the operating findings themselves.",
        wouldChangeIf: "The current KPI settings and reporting dates are independently verified as complete and current.",
        evidence
      }
    ];
  }

  return [
    {
      action: reference
        ? `Validate ${reference.title} with the leader closest to the underlying source and one independent current record.`
        : "Connect one current KPI source and one current operational or financial source before ranking company-wide priorities.",
      priority: "High",
      expectedBusinessImpact: "Reduces the risk of committing leadership attention to a narrow or outdated signal.",
      urgency: "The available information does not yet support an irreversible or company-wide decision.",
      expectedOutcome: "A verified signal that leadership can either act on or dismiss with confidence.",
      timeHorizon: "Immediate",
      confidence: reference ? "Low" : "Insufficient",
      whyPrioritized: "Verification is the highest-value reversible action while evidence coverage is limited.",
      wouldChangeIf: "A second independent current source confirms or contradicts the signal.",
      evidence
    },
    {
      action: "Define or confirm the target, reporting period, and accountable source for the decision-critical measure.",
      priority: "Medium",
      expectedBusinessImpact: "Creates a decision baseline without inventing a trend or target.",
      urgency: "Leadership cannot distinguish normal variation from material change without a current baseline.",
      expectedOutcome: "A measurable threshold for the next leadership review.",
      timeHorizon: "30 Days",
      confidence: reference ? "Low" : "Insufficient",
      whyPrioritized: "This makes the next decision more reliable while preserving flexibility.",
      wouldChangeIf: "A confirmed target and current reporting period are already present in an original source.",
      evidence
    }
  ];
}

export function buildLimitedEvidenceExecutiveAnswer({
  query,
  boundedContext,
  reasoningContext,
  failureReason
}: {
  query: string;
  boundedContext: BoundedWorkspaceContext;
  reasoningContext: ExecutiveReasoningContext;
  failureReason?: string;
}): GlobalSearchAnswer {
  const snapshot = record(boundedContext.workspaceSnapshot);
  const structured = record(snapshot.structured_context);
  const healthContext = record(structured.business_health_score_context);
  const reports = Array.isArray(structured.reports) ? structured.reports.map(record) : [];
  const unlinkedReportTitle = reports.map((report) => stringValue(report.title)).find(Boolean) || "";
  const currentAssessment = record(healthContext.current_assessment);
  const coverage = record(healthContext.coverage_indicators);
  const score = numberValue(currentAssessment.score);
  const dataQualityScore = numberValue(currentAssessment.data_quality_score);
  const original = reasoningContext.rankedEvidence.find((item) => item.evidenceRole === "original") || null;
  const secondary = reasoningContext.rankedEvidence.find((item) => item.evidenceRole !== "supporting") || null;
  const healthEvidence = reasoningContext.rankedEvidence.find((item) => item.domain === "business_health") || null;
  const selected = isBusinessHealthQuestion(query) ? healthEvidence || original || secondary : original || secondary;
  const reference = selected
    ? canonicalReference(
        selected,
        reasoningContext,
        selected.evidenceRole === "original"
          ? "This is the strongest directly supported source available for this question."
          : selected.evidenceRole === "historical"
            ? "This is the recorded historical assessment used to explain the saved score."
            : "This is secondary context; its underlying original evidence is not independently available here."
      )
    : null;
  const originalReference = original && original.key !== selected?.key
    ? canonicalReference(original, reasoningContext, "This original source supports the current assessment context.")
    : null;
  const references = [reference, originalReference].filter((item): item is ExecutiveEvidenceReference => Boolean(item));
  const independentSourceCount = reasoningContext.independentSourceCount;
  const sufficiency = independentSourceCount ? "Partial" as const : "Insufficient" as const;
  const businessHealth = isBusinessHealthQuestion(query) && score !== null;
  const directAnswer = businessHealth
    ? `Your Business Health score is ${score} out of 100; leadership should separate the operating findings affecting the score from the data-readiness gaps affecting how reliably it can be interpreted.`
    : original && independentSourceCount > 1
      ? `${original.title} is the most relevant current source for this question, but the cross-source analysis did not complete, so this response does not infer a broader conclusion.`
      : original
      ? `${original.title} is the strongest supported signal for this question, but one narrow evidence base is not enough for a company-wide conclusion.`
      : selected?.evidenceRole === "derived" || unlinkedReportTitle
        ? "A prior analysis is available, but its underlying original evidence is not independently available for this decision, so leadership should not treat it as current corroboration."
        : "Leadership cannot yet make a reliable company-wide conclusion from the connected information, but it can reduce decision risk immediately by establishing a current, independently supported baseline.";
  const dataConfidence = stringValue(currentAssessment.data_confidence) || "not established";
  const sourceFiles = numberValue(coverage.original_source_files) || 0;
  const kpiRecords = numberValue(coverage.kpi_records) || 0;
  const healthReadiness = businessHealth
    ? `The latest assessment records a data-quality base of ${dataQualityScore ?? "not established"} and ${dataConfidence.toLowerCase()} data confidence, with ${kpiRecords} KPI record${kpiRecords === 1 ? "" : "s"} and ${sourceFiles} original source file${sourceFiles === 1 ? "" : "s"} recorded at that time. The score starts from data quality, subtracts 12 points for each High-priority risk and 6 for each Medium-priority risk up to 45 points, then adds 4 points per opportunity up to 15. The saved snapshot does not preserve the item-by-item adjustments, so that breakdown should not be inferred.`
    : original && independentSourceCount > 1
      ? `${independentSourceCount} independent original sources across ${reasoningContext.originalSourceTypeCount} evidence type${reasoningContext.originalSourceTypeCount === 1 ? "" : "s"} are available. This limited response avoids a cross-source conclusion because the deeper comparison did not complete.`
      : original
      ? `One independent original source supports a narrow conclusion. Its scale, persistence, and relationship to the rest of the business are not yet corroborated.`
      : selected?.evidenceRole === "derived" || unlinkedReportTitle
        ? "Only secondary analysis is available for this question. Original evidence is required before its conclusions can support a new leadership decision."
        : "No independent original source currently supports this question. That limits decision confidence, but it does not indicate that the business itself is performing poorly.";
  const narrowFinding = reference
    ? [{
        finding: businessHealth
          ? `The recorded Business Health score is ${score}, with a recorded data-quality base of ${dataQualityScore ?? "not established"}.`
          : `${reference.title} is relevant to the question, but its broader significance is not established.`,
        businessImpact: businessHealth
          ? "The score can guide a review, but it cannot by itself distinguish operating performance from assessment readiness."
          : "Leadership can review this signal now, but should not generalize it across the company without corroboration.",
        confidence: original ? "Low" as const : "Insufficient" as const,
        evidence: references
      }]
    : [];
  const missingInformation = generalMissingInformation(query);
  const actions = limitedActions({ query, reference, evidence: references, healthContext });
  const readinessExplanation = sufficiency === "Partial"
    ? independentSourceCount > 1
      ? "The answer is limited because the cross-source analysis did not complete; the available sources are not being summarized into an unsupported conclusion."
      : "The answer is limited to a narrow supported signal because independent source coverage is not broad enough for a company-wide conclusion."
    : "The answer is limited to decision-readiness guidance because no independent original evidence supports a business conclusion.";
  const confidenceExplanation = [
    readinessExplanation,
    failureReason || "",
    boundedContext.limitations[0] || ""
  ].filter(Boolean).join(" ");

  const executiveBriefing: ExecutiveIntelligenceBriefing = {
    variant: "limited",
    evidenceSufficiency: { state: sufficiency, explanation: readinessExplanation },
    executiveSummary: directAnswer,
    keyFindings: narrowFinding,
    rootCauseAnalysis: [],
    businessImpact: {
      financial: "Not established from the current evidence.",
      operational: businessHealth
        ? "The score indicates that leadership should review both current operating findings and assessment readiness."
        : "The immediate operational concern is decision quality, not a confirmed operating failure.",
      customer: "Not established from the current evidence.",
      strategic: "Acting on a narrow or unverified conclusion could misdirect leadership attention.",
      ifIgnored: "Leadership may continue making decisions without a current, independently supported baseline."
    },
    recommendedActions: actions,
    supportingEvidence: evidenceGroups(references),
    confidenceAssessment: {
      level: original ? "Low" : "Insufficient",
      explanation: confidenceExplanation,
      supportingSourceCount: original ? 1 : 0,
      evidenceAgreement: "Insufficient",
      conflicts: [],
      uncertainty: missingInformation.slice(0, 3)
    },
    missingInformation,
    limitedEvidence: {
      evidenceReadinessSummary: healthReadiness,
      provisionalInterpretations: original && reference
        ? [{
            statement: businessHealth
              ? "The score may reflect a combination of operating pressure and limited assessment readiness; the current snapshot does not support assigning the gap to either one alone."
              : `${reference.title} may warrant leadership attention, but its scale and persistence are not established.`,
            evidence: references
          }]
        : [],
      alternativeExplanations: original && reference
        ? [{
            statement: businessHealth
              ? "The score could be affected by operating risks, evidence-readiness limits, or both; current source lineage is not sufficient to separate them conclusively."
              : "The signal may be isolated rather than representative of a wider pattern; a second current source is needed to distinguish scope.",
            evidence: references
          }]
        : [],
      conflictAssessment: undefined,
      leadershipRisk: "The principal near-term risk is making a broad or irreversible decision with evidence that is narrow, stale, incomplete, or not independently corroborated.",
      decisionsToDefer: [
        "A company-wide risk ranking based on the current evidence alone",
        "Irreversible operating or investment changes tied to an unconfirmed cause",
        "Financial impact estimates that are not present in original source data"
      ]
    },
    leadershipBrief: {
      priorities: [actions[0].action, actions[1].action, `Connect the missing evidence needed to answer: ${query}`],
      firstLeadershipMeeting: reference
        ? `Start with a short evidence review of ${reference.title}, its date, scope, and accountable source.`
        : "Start with a short decision-readiness review: identify the decision leadership needs to make and the two current sources required to support it.",
      biggestDecision: "Decide which conclusion is important enough to verify first; defer broader action until that verification is complete.",
      biggestOpportunity: "Create a reliable operating baseline that allows the next leadership decision to be faster and better supported.",
      biggestUnknown: missingInformation[0]
    }
  };

  return {
    kind: "business_answer",
    directAnswer,
    recommendationConfidence: executiveBriefing.confidenceAssessment.level,
    evidenceNote: confidenceExplanation,
    executiveBriefing
  };
}
