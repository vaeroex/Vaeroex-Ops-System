import type { BusinessHealthSnapshotRow } from "@/lib/intelligence/business-health-history";
import type { BusinessIntelligenceCoverageResult } from "@/lib/intelligence/coverage";
import type { IntelligenceInsight, IntelligenceLayerResult } from "@/lib/intelligence/layer";

export type ExecutivePriorityTone = "risk" | "opportunity" | "decision";

export type ExecutivePriorityCard = {
  label: string;
  title: string;
  summary: string;
  metadata: string;
  confidence: "High" | "Medium" | "Low";
  actionLabel: string;
  href: "/app/intelligence" | "/app/sources";
  tone: ExecutivePriorityTone;
  empty: boolean;
};

export type ExecutiveChange = {
  id: string;
  title: string;
  detail: string;
  tone: "positive" | "negative" | "neutral";
};

export type ExecutiveHomepageModel = {
  health: {
    available: boolean;
    score: number | null;
    status: string;
    trend: string | null;
    trendDelta: number | null;
    summary: string;
    driver: string;
    confidence: "High" | "Medium" | "Low";
    memorySignals: number;
  };
  priorities: [ExecutivePriorityCard, ExecutivePriorityCard, ExecutivePriorityCard];
  changes: {
    state: "changes" | "first_review" | "none" | "unavailable";
    items: ExecutiveChange[];
    message: string;
  };
  readiness: {
    available: boolean;
    coverage: number;
    label: "Limited" | "Partial" | "Good" | "Strong";
    strongestArea: string;
    strongestCoverage: number;
    largestGap: string;
    recommendedNextSource: string;
    showAddInformation: boolean;
  };
};

type KpiTrendInput = {
  name: string;
  changePercent: number | null;
};

type BuildExecutiveHomepageInput = {
  intelligence: IntelligenceLayerResult;
  coverage: BusinessIntelligenceCoverageResult;
  snapshots: BusinessHealthSnapshotRow[];
  kpiTrends: KpiTrendInput[];
  sourceDataAvailable: boolean;
};

function conciseSentences(value: string | null | undefined, fallback: string, count = 2) {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  const source = normalized || fallback;

  const sentences = source.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((sentence) => sentence.trim()).filter(Boolean) || [];
  const concise = (sentences.length ? sentences.slice(0, count).join(" ") : source).trim();
  const maximumLength = 360;
  if (concise.length <= maximumLength) return concise;

  const shortened = concise.slice(0, maximumLength + 1).replace(/\s+\S*$/, "").trim();
  return `${shortened || concise.slice(0, maximumLength).trim()}...`;
}

function businessSignalExample(insight: IntelligenceInsight) {
  const examples = insight.evidence.find((entry) => entry.startsWith("Examples:"));
  const example = examples?.replace(/^Examples:\s*/i, "").split(",")[0]?.trim();
  return example ? conciseSentences(example, "", 1) : null;
}

function findingTitle(insight: IntelligenceInsight, kind: "risk" | "opportunity") {
  if (insight.title.toLowerCase().includes("may indicate")) {
    const example = businessSignalExample(insight);
    if (example) return example;
    return kind === "risk" ? "Current Business Signals need more context" : "A supported opportunity is emerging";
  }

  return conciseSentences(insight.title, kind === "risk" ? "Current risk requires review" : "A supported opportunity is emerging", 1);
}

function emptyPriority(tone: ExecutivePriorityTone): ExecutivePriorityCard {
  if (tone === "risk") {
    return {
      label: "Top Risk",
      title: "No evidence-backed risk requires attention",
      summary: "Vaeroex does not currently see a supported risk that should dominate leadership attention.",
      metadata: "No active high-priority risk",
      confidence: "Low",
      actionLabel: "Review intelligence",
      href: "/app/intelligence",
      tone,
      empty: true
    };
  }

  if (tone === "opportunity") {
    return {
      label: "Top Opportunity",
      title: "No evidence-backed opportunity requires attention",
      summary: "Current eligible evidence does not support a specific opportunity claim yet.",
      metadata: "More relevant history may reveal one",
      confidence: "Low",
      actionLabel: "Review intelligence",
      href: "/app/intelligence",
      tone,
      empty: true
    };
  }

  return {
    label: "Recommended Decision",
    title: "No immediate leadership decision is supported",
    summary: "Continue monitoring current evidence until a material risk or opportunity emerges.",
    metadata: "No decision threshold reached",
    confidence: "Low",
    actionLabel: "Review intelligence",
    href: "/app/intelligence",
    tone,
    empty: true
  };
}

function priorityFromInsight(insight: IntelligenceInsight | undefined, tone: "risk" | "opportunity"): ExecutivePriorityCard {
  if (!insight) return emptyPriority(tone);

  return {
    label: tone === "risk" ? "Top Risk" : "Top Opportunity",
    title: findingTitle(insight, tone),
    summary: conciseSentences(insight.summary, "Open the supporting intelligence for the current conclusion."),
    metadata: `Evidence: ${insight.evidenceCount} supporting item${insight.evidenceCount === 1 ? "" : "s"}`,
    confidence: insight.confidence,
    actionLabel: tone === "risk" ? "Review risk" : "Review opportunity",
    href: "/app/intelligence",
    tone,
    empty: false
  };
}

function decisionFromIntelligence(intelligence: IntelligenceLayerResult): ExecutivePriorityCard {
  const recommendation = intelligence.topRecommendation;
  if (!recommendation) return emptyPriority("decision");

  const sourceTitle = findingTitle(recommendation, "risk");
  const example = businessSignalExample(recommendation);
  const title = recommendation.sourceTypes.includes("Business Signals")
    ? example ? `Review ${example}` : "Review the underlying Business Signal evidence"
    : recommendation.sourceTypes.includes("KPIs")
      ? `Review ${recommendation.title.replace(/ is below target$/i, "")} performance`
      : `Review ${sourceTitle.replace(/^\d+ /, "").replace(/ require leadership review$/i, "")}`;

  return {
    label: "Recommended Decision",
    title,
    summary: conciseSentences(recommendation.recommendedAction, recommendation.why, 1),
    metadata: `Priority: ${recommendation.priority}`,
    confidence: recommendation.confidence,
    actionLabel: "Review decision",
    href: "/app/intelligence",
    tone: "decision",
    empty: false
  };
}

function readinessLabel(coverage: number): ExecutiveHomepageModel["readiness"]["label"] {
  if (coverage >= 81) return "Strong";
  if (coverage >= 66) return "Good";
  if (coverage >= 46) return "Partial";
  return "Limited";
}

function healthStatusLabel(status: IntelligenceLayerResult["businessHealth"]["status"]) {
  if (status === "Strong") return "Healthy";
  if (status === "Watch") return "Watch";
  if (status === "At Risk") return "Critical";
  return "Limited evidence";
}

function previousReviewSnapshot(snapshots: BusinessHealthSnapshotRow[]) {
  const ordered = [...snapshots].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
  const latest = ordered.at(-1);
  if (!latest) return null;

  const today = new Date().toISOString().slice(0, 10);
  return latest.snapshot_date === today ? ordered.at(-2) || null : latest;
}

function buildChanges({
  snapshots,
  currentScore,
  currentConfidence,
  kpiTrends,
  sourceDataAvailable
}: {
  snapshots: BusinessHealthSnapshotRow[];
  currentScore: number;
  currentConfidence: string;
  kpiTrends: KpiTrendInput[];
  sourceDataAvailable: boolean;
}): ExecutiveHomepageModel["changes"] {
  if (!sourceDataAvailable) {
    return {
      state: "unavailable",
      items: [],
      message: "Changes are temporarily unavailable because required business information could not be retrieved."
    };
  }

  const previous = previousReviewSnapshot(snapshots);
  if (!previous) {
    return {
      state: "first_review",
      items: [],
      message: "This is the first intelligence review for this workspace. Changes will appear after additional eligible evidence is processed."
    };
  }

  const items: ExecutiveChange[] = [];
  const healthDelta = currentScore - previous.score;

  if (healthDelta !== 0) {
    items.push({
      id: "business-health",
      title: `Business Health ${healthDelta > 0 ? "increased" : "decreased"} ${Math.abs(healthDelta)} point${Math.abs(healthDelta) === 1 ? "" : "s"}`,
      detail: `From ${previous.score} to ${currentScore} since the previous stored review.`,
      tone: healthDelta > 0 ? "positive" : "negative"
    });
  }

  if (previous.data_confidence !== currentConfidence) {
    items.push({
      id: "confidence",
      title: `Intelligence confidence changed to ${currentConfidence}`,
      detail: `The previous stored review was ${previous.data_confidence}.`,
      tone: "neutral"
    });
  }

  for (const trend of [...kpiTrends]
    .filter((item) => typeof item.changePercent === "number" && Math.abs(item.changePercent) >= 1)
    .sort((a, b) => Math.abs(b.changePercent || 0) - Math.abs(a.changePercent || 0))
    .slice(0, Math.max(0, 5 - items.length))) {
    const change = trend.changePercent || 0;
    items.push({
      id: `kpi-${trend.name}`,
      title: `${trend.name} ${change > 0 ? "increased" : "decreased"} ${Math.abs(change).toFixed(1).replace(/\.0$/, "")}%`,
      detail: "Compared with the previous selected reporting period.",
      tone: "neutral"
    });
  }

  return items.length
    ? { state: "changes", items: items.slice(0, 5), message: "" }
    : { state: "none", items: [], message: "No material business changes were detected since the previous review." };
}

export function buildExecutiveHomepageModel({
  intelligence,
  coverage,
  snapshots,
  kpiTrends,
  sourceDataAvailable
}: BuildExecutiveHomepageInput): ExecutiveHomepageModel {
  const hasUsableHealth = sourceDataAvailable && intelligence.businessHealth.available !== false;
  const risk = hasUsableHealth ? intelligence.topRisk : undefined;
  const opportunity = hasUsableHealth ? intelligence.topOpportunity : undefined;
  const memorySignals = intelligence.memorySummary.sourceRecords + intelligence.memorySummary.kpiHistoryRecords;
  const previousSnapshot = previousReviewSnapshot(snapshots);
  const trendDelta = previousSnapshot ? intelligence.businessHealth.score - previousSnapshot.score : null;
  const strongest = [...coverage.categories].sort((a, b) => b.coverage - a.coverage)[0];
  const weakest = [...coverage.categories].sort((a, b) => a.coverage - b.coverage)[0];

  const healthSummary = !hasUsableHealth
    ? sourceDataAvailable
      ? "Vaeroex needs more eligible original evidence before it can score Business Health reliably."
      : "Some required business information could not be retrieved. Existing evidence remains available in Intelligence and Sources."
    : risk
      ? conciseSentences(risk.summary, intelligence.executiveSummary)
      : opportunity
        ? conciseSentences(opportunity.summary, intelligence.executiveSummary)
        : conciseSentences(intelligence.executiveSummary, "No material business risk is visible in the current eligible evidence.");

  const healthDriver = !hasUsableHealth
    ? sourceDataAvailable
      ? "Setup context, generated outputs, and Business Memory do not count as independent business evidence."
      : "No business conclusion was generated from the unavailable source queries."
    : conciseSentences(
      risk?.evidence[0] || opportunity?.evidence[0],
      "No single evidence-backed driver currently dominates Business Health.",
      1
    );

  return {
    health: {
      available: hasUsableHealth,
      score: hasUsableHealth ? intelligence.businessHealth.score : null,
      status: hasUsableHealth ? healthStatusLabel(intelligence.businessHealth.status) : "Limited evidence",
      trend: hasUsableHealth && trendDelta !== null ? intelligence.businessHealth.trend : null,
      trendDelta,
      summary: healthSummary,
      driver: healthDriver,
      confidence: hasUsableHealth ? intelligence.dataQuality.confidence : "Low",
      memorySignals: sourceDataAvailable ? memorySignals : 0
    },
    priorities: hasUsableHealth
      ? [priorityFromInsight(risk, "risk"), priorityFromInsight(opportunity, "opportunity"), decisionFromIntelligence(intelligence)]
      : [emptyPriority("risk"), emptyPriority("opportunity"), emptyPriority("decision")],
    changes: buildChanges({
      snapshots,
      currentScore: intelligence.businessHealth.score,
      currentConfidence: intelligence.dataQuality.confidence,
      kpiTrends,
      sourceDataAvailable: hasUsableHealth
    }),
    readiness: {
      available: sourceDataAvailable,
      coverage: coverage.overallCoverage,
      label: readinessLabel(coverage.overallCoverage),
      strongestArea: strongest?.label || "No established area yet",
      strongestCoverage: strongest?.coverage || 0,
      largestGap: weakest?.label || "More source history",
      recommendedNextSource: weakest?.recommendedNextUpload || coverage.recommendedNextUpload,
      showAddInformation: coverage.overallCoverage < 81
    }
  };
}
