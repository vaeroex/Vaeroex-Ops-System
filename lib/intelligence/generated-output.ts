import type { Route } from "next";
import type {
  IntelligenceConfidence,
  IntelligenceInsight,
  IntelligenceInsightType,
  IntelligenceLayerResult
} from "@/lib/intelligence/layer";

export type GeneratedOutputType = "action_plan" | "risk_brief" | "checklist" | "sop" | "executive_briefing" | "meeting_agenda";

export type GeneratedOutputSource = Pick<
  IntelligenceInsight,
  "title" | "summary" | "why" | "impact" | "recommendedAction" | "confidence" | "evidence" | "evidenceCount" | "sourceTypes" | "sourceHref" | "suggestedNextData"
> & {
  type?: IntelligenceInsightType;
};

export type GeneratedOutput = {
  type: GeneratedOutputType;
  label: string;
  title: string;
  subtitle: string;
  summary: string;
  whyMatters: string;
  recommendedRemedy: string;
  evidence: string[];
  evidenceCount: number;
  confidence: IntelligenceConfidence;
  sourceTypes: string[];
  sourceHref: string;
  limitations: string;
  suggestedNextData: string[];
  markdown: string;
};

export type GeneratedOutputCoverageSummary = {
  overallCoverage: number;
  overallConfidenceLabel: string;
  recommendedNextUpload: string;
  forecastReadiness: {
    label: string;
    reason: string;
  };
};

const OUTPUT_LABELS: Record<GeneratedOutputType, string> = {
  action_plan: "Generated Improvement Plan",
  risk_brief: "Generated Investigation Summary",
  checklist: "Generated Checklist Draft",
  sop: "Generated SOP Draft",
  executive_briefing: "Generated Executive Briefing",
  meeting_agenda: "Generated Meeting Brief"
};

const OUTPUT_NAMES: Record<GeneratedOutputType, string> = {
  action_plan: "Improvement Plan",
  risk_brief: "Investigation Summary",
  checklist: "Checklist Draft",
  sop: "SOP Draft",
  executive_briefing: "Executive Briefing",
  meeting_agenda: "Meeting Brief"
};

export function parseGeneratedOutputType(value: string | null | undefined): GeneratedOutputType {
  if (
    value === "risk_brief" ||
    value === "checklist" ||
    value === "sop" ||
    value === "executive_briefing" ||
    value === "meeting_agenda"
  ) {
    return value;
  }

  return "action_plan";
}

export function generatedOutputLabel(type: GeneratedOutputType) {
  return OUTPUT_LABELS[type];
}

export function generatedOutputHref({
  type,
  source,
  title,
  summary,
  why,
  remedy,
  run
}: {
  type: GeneratedOutputType;
  source?: string;
  title?: string;
  summary?: string;
  why?: string;
  remedy?: string;
  run?: string;
}) {
  const params = new URLSearchParams({ type });

  if (source) params.set("source", source);
  if (title) params.set("title", title);
  if (summary) params.set("summary", summary);
  if (why) params.set("why", why);
  if (remedy) params.set("remedy", remedy);
  if (run) params.set("run", run);

  return `/app/generated/new?${params.toString()}` as Route;
}

export function outputTypeForInsight(insight: Pick<IntelligenceInsight, "type">): GeneratedOutputType {
  if (insight.type === "Risk" || insight.type === "Anomaly" || insight.type === "Bottleneck") {
    return "risk_brief";
  }

  if (insight.type === "Recommendation") {
    return "action_plan";
  }

  return "executive_briefing";
}

function bulletList(items: string[]) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- No supporting evidence was available yet.";
}

function numberedList(items: string[]) {
  return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

function clean(value: string | null | undefined, fallback: string) {
  return value && value.trim() ? value.trim() : fallback;
}

function sourceForType(type: GeneratedOutputType, intelligence: IntelligenceLayerResult) {
  if (type === "risk_brief") return intelligence.topRisk;
  if (type === "executive_briefing" || type === "meeting_agenda") return intelligence.topRecommendation || intelligence.topRisk || intelligence.topOpportunity;
  if (type === "checklist" || type === "sop") return intelligence.topRecommendation || intelligence.topRisk || intelligence.topOpportunity;
  return intelligence.topRecommendation || intelligence.topRisk || intelligence.topOpportunity;
}

export function fallbackGeneratedOutputSource(type: GeneratedOutputType, intelligence: IntelligenceLayerResult): GeneratedOutputSource {
  const source = sourceForType(type, intelligence);

  if (source) {
    return source;
  }

  return {
    type: "Recommendation",
    title: "Add more business context",
    summary: intelligence.executiveSummary || "Vaeroex needs more source data before generating a high-confidence output.",
    why: intelligence.dataQuality.reason,
    impact: "More complete source data improves visibility, confidence, and decision support.",
    recommendedAction: intelligence.dataQuality.suggestedNextData[0] || "Upload current reports, KPI history, or source files.",
    confidence: intelligence.dataQuality.confidence,
    evidence: [`Business memory score: ${intelligence.dataQuality.score}/100`, intelligence.dataQuality.reason],
    evidenceCount: Math.max(1, intelligence.memorySummary.sourceRecords),
    sourceTypes: ["Business Memory"],
    sourceHref: "/app/sources",
    suggestedNextData: intelligence.dataQuality.suggestedNextData[0]
  };
}

export function sourceFromSearchParams({
  params,
  intelligence
}: {
  params: URLSearchParams;
  intelligence: IntelligenceLayerResult;
}): GeneratedOutputSource {
  const type = parseGeneratedOutputType(params.get("type"));
  const sourceId = params.get("source");
  const matched = sourceId ? intelligence.insights.find((insight) => insight.id === sourceId) : null;
  const fallback = matched || fallbackGeneratedOutputSource(type, intelligence);
  const title = clean(params.get("title"), fallback.title);
  const summary = clean(params.get("summary"), fallback.summary);
  const why = clean(params.get("why"), fallback.why);
  const recommendedAction = clean(params.get("remedy"), fallback.recommendedAction);

  return {
    ...fallback,
    title,
    summary,
    why,
    recommendedAction,
    evidence: fallback.evidence.length ? fallback.evidence : ["Workspace business memory and current Vaeroex context."],
    evidenceCount: Math.max(fallback.evidenceCount, fallback.evidence.length || 1)
  };
}

function outputBody(type: GeneratedOutputType, source: GeneratedOutputSource, intelligence: IntelligenceLayerResult) {
  if (type === "risk_brief") {
    return [
      "## Risk Summary",
      source.summary,
      "",
      "## Likely Root Cause",
      source.why,
      "",
      "## Business Impact",
      source.impact,
      "",
      "## Recommended Remedy",
      source.recommendedAction,
      "",
      "## Evidence",
      bulletList(source.evidence)
    ].join("\n");
  }

  if (type === "checklist") {
    return [
      `## Checklist Name`,
      `${source.title} review checklist`,
      "",
      "## Purpose",
      source.summary,
      "",
      "## When To Use It",
      "Use this when leadership wants a repeatable review before deciding how the recommendation should be handled in existing systems.",
      "",
      "## Checklist Steps",
      numberedList([
        "Review the Vaeroex signal and confirm the business context.",
        "Check the supporting evidence before making a decision.",
        "Decide whether the issue is urgent, important, or informational.",
        "Identify the simplest remedy that reduces risk or improves visibility.",
        "Record the outcome in a briefing or document the decision in your existing operating system."
      ]),
      "",
      "## Evidence",
      bulletList(source.evidence)
    ].join("\n");
  }

  if (type === "sop") {
    return [
      `## SOP Title`,
      `${source.title} response procedure`,
      "",
      "## Purpose",
      source.summary,
      "",
      "## Scope",
      "Use this draft as a practical leadership procedure. It is not active policy until reviewed and approved by your organization.",
      "",
      "## Procedure",
      numberedList([
        "Review the Vaeroex signal and evidence.",
        "Confirm whether the context still reflects current operations.",
        "Choose the remedy leadership wants to standardize.",
        "Communicate the expected standard to the relevant people or team.",
        "Review outcomes during the next briefing cycle."
      ]),
      "",
      "## Roles Involved",
      "Leadership, the workspace owner, and any team members responsible for the affected process.",
      "",
      "## Review Notes",
      source.recommendedAction,
      "",
      "## Evidence",
      bulletList(source.evidence)
    ].join("\n");
  }

  if (type === "executive_briefing") {
    const topRisk = intelligence.topRisk;
    const topOpportunity = intelligence.topOpportunity;
    const topRecommendation = intelligence.topRecommendation;

    return [
      "## Executive Summary",
      intelligence.executiveSummary,
      "",
      "## Top Risk",
      topRisk ? `${topRisk.title}: ${topRisk.summary}` : "No major risk signal is strong enough yet.",
      "",
      "## Top Opportunity",
      topOpportunity ? `${topOpportunity.title}: ${topOpportunity.summary}` : "No clear opportunity signal is strong enough yet.",
      "",
      "## Executive Recommendations",
      bulletList(
        [topRecommendation?.recommendedAction, source.recommendedAction]
          .filter((item): item is string => Boolean(item))
          .filter((item, index, array) => array.indexOf(item) === index)
      ),
      "",
      "## Evidence",
      bulletList(source.evidence)
    ].join("\n");
  }

  if (type === "meeting_agenda") {
    return [
      "## Meeting Purpose",
      source.summary,
      "",
      "## Findings",
      bulletList(source.evidence.slice(0, 5)),
      "",
      "## Risks to Discuss",
      source.why,
      "",
      "## Opportunities to Discuss",
      source.impact,
      "",
      "## Recommended Discussion Topics",
      numberedList([
        "What did this source reveal that leadership did not already know?",
        "Which risk or opportunity deserves executive attention first?",
        "What evidence supports the conclusion?",
        "What additional source data would increase confidence?",
        source.recommendedAction
      ]),
      "",
      "## Confidence Level",
      source.confidence,
      "",
      "## Evidence Summary",
      bulletList(source.evidence)
    ].join("\n");
  }

  return [
    "## Problem",
    source.summary,
    "",
    "## Why It Matters",
    source.why,
    "",
    "## Executive Review Steps",
    numberedList([
      "Review the evidence behind this Vaeroex recommendation.",
      "Decide whether the recommendation should become an executive report, meeting agenda, SOP, checklist, or improvement plan.",
      source.recommendedAction,
      "Save the final output to Briefings if leadership needs a record.",
      "Review the outcome during the next leadership check-in."
    ]),
    "",
    "## Expected Impact",
    source.impact,
    "",
    "## Evidence",
    bulletList(source.evidence)
  ].join("\n");
}

export function buildGeneratedOutput({
  type,
  source,
  intelligence,
  workspaceName,
  coverage
}: {
  type: GeneratedOutputType;
  source: GeneratedOutputSource;
  intelligence: IntelligenceLayerResult;
  workspaceName?: string | null;
  coverage?: GeneratedOutputCoverageSummary;
}): GeneratedOutput {
  const label = generatedOutputLabel(type);
  const name = OUTPUT_NAMES[type];
  const suggestedNextData = [
    source.suggestedNextData,
    ...intelligence.dataQuality.suggestedNextData
  ].filter((item): item is string => Boolean(item));
  const sourceTypes = source.sourceTypes.length ? source.sourceTypes : ["Business Memory"];
  const limitations =
    source.confidence === "High"
      ? "Confidence is high for a draft recommendation, but leadership should still review before using it operationally."
      : source.confidence === "Medium"
        ? "Confidence is medium because Vaeroex has useful evidence but would benefit from more historical context."
        : "Confidence is limited. Treat this as a starting point and add more source data before making major decisions.";
  const markdown = [
    `# ${name}: ${source.title}`,
    "",
    `Workspace: ${workspaceName || "Current workspace"}`,
    `Confidence: ${source.confidence}`,
    `Source records/signals: ${source.evidenceCount}`,
    "",
    outputBody(type, source, intelligence),
    "",
    ...(coverage
      ? [
          "## Business Intelligence Coverage",
          `Current coverage: ${coverage.overallCoverage}% (${coverage.overallConfidenceLabel})`,
          `Forecast readiness: ${coverage.forecastReadiness.label}`,
          coverage.forecastReadiness.reason,
          `Recommended next upload: ${coverage.recommendedNextUpload}`,
          ""
        ]
      : []),
    "## Data Quality and Limitations",
    limitations,
    "",
    "## Suggested Next Data",
    bulletList(suggestedNextData.length ? suggestedNextData : ["Continue adding current reports, KPI history, and source context."])
  ].join("\n");

  return {
    type,
    label,
    title: `${label}: ${source.title}`,
    subtitle: "Based on Vaeroex intelligence from this workspace.",
    summary: source.summary,
    whyMatters: source.why,
    recommendedRemedy: source.recommendedAction,
    evidence: source.evidence,
    evidenceCount: source.evidenceCount,
    confidence: source.confidence,
    sourceTypes,
    sourceHref: source.sourceHref,
    limitations,
    suggestedNextData,
    markdown
  };
}
